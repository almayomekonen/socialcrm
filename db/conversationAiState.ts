/**
 * AI Lead Qualifier — conversation_ai_state data layer (P0b table). CRUD + the
 * fill-empty qualification write. One row per conversation that the qualifier has
 * touched; a single worker owns a conversation at a time (in-flight unique index),
 * so read-merge-write here is race-safe.
 */
import { db } from '@/config/db'
import { mergeQualification, type AiState, type Qualification } from '@/lib/inbox/autoresponse/qualification'
import { stateAfterAgentTurn } from '@/lib/inbox/autoresponse/agentOwnership'

export interface ConversationAiStateRow {
  conversationId: number
  agencyId: number
  aiState: AiState
  aiTurnCount: number
  aiLastAt: string | null
  qualification: Qualification
  escalatedAt: string | null
  escalationReason: string | null
  stoppedReason: string | null
  /** Human Presence — TTL expiry of the transient typing signal. Never a latch. */
  humanTypingUntil: string | null
  /** Human Presence — last keystroke heartbeat. Compared against the turn epoch. */
  humanTypingAt: string | null
  humanTypingUserId: number | null
  /** Rolling summary of everything older than the recent-message window. */
  summary: string | null
  /** Highest message sequence the summary accounts for. 0 = nothing summarised. */
  summaryThroughSequence: number
}

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

function mapRow(r: Record<string, unknown>): ConversationAiStateRow {
  const q = r.qualification
  return {
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    aiState: r.aiState as AiState,
    aiTurnCount: Number(r.aiTurnCount),
    aiLastAt: toIso(r.aiLastAt),
    qualification: (typeof q === 'string' ? JSON.parse(q) : (q ?? {})) as Qualification,
    escalatedAt: toIso(r.escalatedAt),
    escalationReason: (r.escalationReason as string | null) ?? null,
    stoppedReason: (r.stoppedReason as string | null) ?? null,
    humanTypingUntil: toIso(r.humanTypingUntil),
    humanTypingAt: toIso(r.humanTypingAt),
    humanTypingUserId: r.humanTypingUserId == null ? null : Number(r.humanTypingUserId),
    summary: (r.summary as string | null) ?? null,
    summaryThroughSequence: Number(r.summaryThroughSequence ?? 0),
  }
}

export async function getAiState(conversationId: number): Promise<ConversationAiStateRow | null> {
  const row = await db('conversation_ai_state').where({ conversationId }).first()
  return row ? mapRow(row) : null
}

/** Returns the row, creating a fresh `new`-state row if none exists. */
export async function getOrCreateAiState(conversationId: number, agencyId: number): Promise<ConversationAiStateRow> {
  await db('conversation_ai_state')
    .insert({ conversationId, agencyId })
    .onConflict('conversationId')
    .ignore()
  return (await getAiState(conversationId)) as ConversationAiStateRow
}

async function patch(conversationId: number, fields: Record<string, unknown>): Promise<void> {
  await db('conversation_ai_state')
    .where({ conversationId })
    .update({ ...fields, updatedAt: db.fn.now() })
}

/**
 * Record one AI turn: bump count, merge the extracted fields, stamp aiLastAt,
 * keep qualifying.
 *
 * `corrected` names the fields the customer explicitly corrected this turn, and
 * is the only way a known value is replaced — without it the merge stays
 * fill-empty and the first value the customer gave becomes permanent.
 *
 * DOES NOT RESURRECT. This used to write `aiState = 'ai_qualifying'`
 * unconditionally, so recording a turn against a human-owned, opted-out or
 * closed conversation handed it straight back to the agent. Nothing reaches here
 * in those states today because decidePreGeneration stops first — which is
 * exactly what made it invisible, and exactly one reordering away from the agent
 * speaking over a rep or messaging someone who had opted out. The turn count and
 * the merged memory are still recorded; only the lifecycle is left alone.
 */
export async function recordTurn(
  conversationId: number,
  extracted: Qualification,
  corrected?: readonly string[],
): Promise<void> {
  const cur = await getAiState(conversationId)
  const merged = mergeQualification(cur?.qualification ?? {}, extracted, { corrected })
  const nextState = stateAfterAgentTurn(cur?.aiState)
  await patch(conversationId, {
    ...(nextState ? { aiState: nextState } : {}),
    aiTurnCount: db.raw('"aiTurnCount" + 1'),
    aiLastAt: db.fn.now(),
    qualification: JSON.stringify(merged),
  })
}

/** Merge extracted fields without advancing the turn (used in draft mode). */
export async function mergeOnly(
  conversationId: number,
  extracted: Qualification,
  corrected?: readonly string[],
): Promise<void> {
  const cur = await getAiState(conversationId)
  const merged = mergeQualification(cur?.qualification ?? {}, extracted, { corrected })
  await patch(conversationId, { qualification: JSON.stringify(merged), aiLastAt: db.fn.now() })
}

/**
 * Advance the rolling summary. Separate from `recordTurn` because the two move
 * on different schedules: a turn is recorded every time the agent speaks, while
 * the summary only moves when the recent-message window actually rolls.
 */
export async function saveConversationSummary(
  conversationId: number,
  summary: string,
  throughSequence: number,
): Promise<void> {
  await patch(conversationId, { summary, summaryThroughSequence: throughSequence })
}

export async function markEscalated(conversationId: number, reason: string): Promise<void> {
  await patch(conversationId, { aiState: 'escalated', escalatedAt: db.fn.now(), escalationReason: reason })
}

/** Permanent: a human took over. */
export async function markHumanActive(conversationId: number): Promise<void> {
  await patch(conversationId, { aiState: 'human_active', stoppedReason: 'human_active' })
}

/** Explicit end of the interaction. Does not resume like dormant. */
export async function markClosed(conversationId: number, reason: string): Promise<void> {
  await patch(conversationId, { aiState: 'closed', stoppedReason: reason })
}

export async function markStopped(conversationId: number, aiState: AiState, reason: string): Promise<void> {
  await patch(conversationId, { aiState, stoppedReason: reason })
}
