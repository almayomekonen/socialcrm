/**
 * WhatsApp Agent — Human Presence data layer.
 *
 * Reads and writes the three transient presence columns on the EXISTING
 * conversation_ai_state row. No second state system: presence and `aiState`
 * live together so the send guard reads one row and they can never disagree.
 *
 * CLOCK. Every timestamp here is Postgres `now()`, and `readHumanPresence`
 * returns the server clock alongside the values it is compared against. The
 * worker process clock is never used for a presence decision — a few seconds of
 * skew between a serverless worker and the database would otherwise decide
 * whether a customer receives a message the rep was in the middle of answering.
 *
 * See lib/inbox/autoresponse/humanPresence.ts for the state model these rows feed.
 */
import { db } from '@/config/db'
import type { AiState } from '@/lib/inbox/autoresponse/qualification'
import { HUMAN_TYPING_TTL_MS, type HumanPresenceFacts } from '@/lib/inbox/autoresponse/humanPresence'

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

/**
 * Presence facts for one conversation, plus the server clock, in a single
 * round trip. A conversation the agent has never touched has no row; that reads
 * as a fresh `new` state with no typing — the agent's default, not a block.
 */
export async function readHumanPresence(conversationId: number): Promise<HumanPresenceFacts> {
  const res = await db.raw(
    `SELECT s."aiState", s."humanTypingUntil", s."humanTypingAt", now() AS now
       FROM (SELECT 1) probe
       LEFT JOIN conversation_ai_state s ON s."conversationId" = ?`,
    [conversationId],
  )
  const r = (res.rows?.[0] ?? {}) as Record<string, unknown>
  return {
    aiState: ((r.aiState as AiState | null) ?? 'new') as AiState,
    humanTypingUntil: iso(r.humanTypingUntil),
    humanTypingAt: iso(r.humanTypingAt),
    now: iso(r.now) ?? new Date().toISOString(),
  }
}

/**
 * Record one keystroke heartbeat. Refreshes the TTL and stamps the monotonic
 * marker the final send authorization compares against the turn epoch.
 *
 * NEVER touches `aiState`. Typing is presence, not takeover: a rep who starts a
 * sentence and abandons it must not leave the conversation permanently silent.
 *
 * Multi-tab / multi-rep safe. `humanTypingAt` always advances to the newest
 * beat, and the TTL takes the FURTHEST expiry of any tab, so a second tab's
 * heartbeat can extend the window but never cut another one short.
 *
 * Agency-scoped by construction: the row is sourced FROM the conversation, so a
 * conversationId belonging to another agency inserts nothing and returns false.
 * There is no version of this call that can write across an agency boundary.
 */
export async function recordHumanTyping(args: {
  conversationId: number
  agencyId: number
  userId?: number | null
  ttlMs?: number
}): Promise<boolean> {
  const ttlSeconds = Math.max(1, Math.round((args.ttlMs ?? HUMAN_TYPING_TTL_MS) / 1000))
  const res = await db.raw(
    `INSERT INTO conversation_ai_state
       ("conversationId","agencyId","humanTypingAt","humanTypingUntil","humanTypingUserId")
     SELECT c.id, c."agencyId", now(), now() + make_interval(secs => :ttlSeconds), :userId
       FROM inbox_conversations c
      WHERE c.id = :conversationId AND c."agencyId" = :agencyId
     ON CONFLICT ("conversationId") DO UPDATE
        SET "humanTypingAt"     = now(),
            "humanTypingUntil"  = GREATEST(conversation_ai_state."humanTypingUntil", EXCLUDED."humanTypingUntil"),
            "humanTypingUserId" = EXCLUDED."humanTypingUserId",
            "updatedAt"         = now()
     RETURNING "conversationId"`,
    {
      conversationId: args.conversationId,
      agencyId: args.agencyId,
      ttlSeconds,
      userId: args.userId ?? null,
    },
  )
  return (res.rows?.length ?? 0) > 0
}

/**
 * The rep sent a message: permanent takeover.
 *
 * Upsert, not update. A rep can answer a brand-new conversation the agent has
 * never processed, in which case no lifecycle row exists yet — an UPDATE would
 * silently match zero rows and the guard would see a `new` conversation while a
 * human was demonstrably in it.
 *
 * Agency-scoped by construction, like recordHumanTyping above.
 */
export async function markHumanActiveByConversation(conversationId: number, agencyId: number): Promise<boolean> {
  const res = await db.raw(
    `INSERT INTO conversation_ai_state ("conversationId","agencyId","aiState","stoppedReason")
     SELECT c.id, c."agencyId", 'human_active', 'human_active'
       FROM inbox_conversations c
      WHERE c.id = :conversationId AND c."agencyId" = :agencyId
     ON CONFLICT ("conversationId") DO UPDATE
        SET "aiState"       = 'human_active',
            "stoppedReason" = 'human_active',
            "updatedAt"     = now()
     RETURNING "conversationId"`,
    { conversationId, agencyId },
  )
  return (res.rows?.length ?? 0) > 0
}

/**
 * A rep pressed "take over": the same permanent pause, recorded as a deliberate
 * act rather than a side effect of sending.
 *
 * REFUSES ON opted_out. An opted-out conversation is already silent, and
 * replacing the customer's own stop with a weaker, rep-authored one would let a
 * later "return to agent" resume messaging someone who asked us not to. The
 * refusal is a WHERE clause, not a read-then-write, so a concurrent opt-out
 * arriving between the two cannot slip through.
 *
 * Agency-scoped by construction, like every writer in this file.
 */
export async function takeOverConversationByRep(args: {
  conversationId: number
  agencyId: number
}): Promise<boolean> {
  const res = await db.raw(
    `INSERT INTO conversation_ai_state ("conversationId","agencyId","aiState","stoppedReason")
     SELECT c.id, c."agencyId", 'human_active', 'human_takeover_explicit'
       FROM inbox_conversations c
      WHERE c.id = :conversationId AND c."agencyId" = :agencyId
     ON CONFLICT ("conversationId") DO UPDATE
        SET "aiState"       = 'human_active',
            -- Preserve how ownership was FIRST acquired. "they replied" and
            -- "they pressed the button" are different histories.
            "stoppedReason" = COALESCE(conversation_ai_state."stoppedReason", 'human_takeover_explicit'),
            "updatedAt"     = now()
      WHERE conversation_ai_state."aiState" <> 'opted_out'
     RETURNING "conversationId"`,
    { conversationId: args.conversationId, agencyId: args.agencyId },
  )
  return (res.rows?.length ?? 0) > 0
}

/**
 * A rep pressed "return to agent" — the ONLY way a paused conversation comes
 * back. No timer, no sweep, no lifecycle edge does this.
 *
 * The state guard lives in the WHERE clause for the same reason as above: it is
 * the difference between "this conversation was human-owned when I checked" and
 * "this conversation is human-owned as I write". Only `human_active` and
 * `escalated` qualify, so `opted_out` and `closed` are refused by construction
 * rather than by remembering to check.
 *
 * Returns to `ai_qualifying`, never `new`: the agent has spoken here, and `new`
 * would re-arm the first-contact greeting for someone twenty messages deep.
 * `aiTurnCount` is untouched for the same reason.
 *
 * Also stamps the ownership epoch (`qualification.ownership.sinceSequence`):
 * without it the rep's earlier messages, still in the transcript window, read
 * as a fresh takeover and paused the agent again on the next customer message.
 */
export async function returnConversationToAgent(args: {
  conversationId: number
  agencyId: number
}): Promise<boolean> {
  const res = await db.raw(
    `UPDATE conversation_ai_state s
        SET "aiState"       = 'ai_qualifying',
            "stoppedReason" = NULL,
            -- The ownership epoch. Human replies up to this sequence belong to
            -- the period the rep is ending now; only a later one takes the
            -- conversation again (lib/inbox/autoresponse/reliability/ownership.ts).
            qualification   = jsonb_set(
                                COALESCE(s.qualification, '{}'::jsonb),
                                '{ownership}',
                                jsonb_build_object(
                                  'sinceSequence',
                                  (SELECT COALESCE(MAX(m.sequence), 0) FROM inbox_messages m WHERE m."conversationId" = c.id),
                                  'returnedAt', now()
                                ),
                                true
                              ),
            "updatedAt"     = now()
       FROM inbox_conversations c
      WHERE s."conversationId" = c.id
        AND c.id = :conversationId
        AND c."agencyId" = :agencyId
        AND s."aiState" IN ('human_active','escalated')
     RETURNING s."conversationId"`,
    { conversationId: args.conversationId, agencyId: args.agencyId },
  )
  return (res.rows?.length ?? 0) > 0
}
