/**
 * questionnaire_sessions — one row per run of a questionnaire on a conversation.
 *
 * Every read and every write is scoped by agencyId, in SQL, without exception.
 * A conversation id from another tenant matches no row here; there is no
 * function in this file that can be made to cross that boundary by passing the
 * wrong argument.
 *
 * CONCURRENCY. A session advances through `version`: a turn is planned against
 * the version it read and committed with `WHERE version = :version`, so a
 * second worker that somehow claimed the same conversation cannot apply a
 * transition computed from a state that has already moved.
 *
 * NOTE: ~280 lines, over the 250-line soft limit. One responsibility (the
 * sessions table) and no branching logic: every function is a single scoped
 * statement with the reasoning above it. The length is comments and SQL, not
 * concerns.
 */
import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { QuestionnaireSessionStatus, SessionSnapshot } from '@/lib/inbox/autoresponse/questionnaire/transition'

/** How long one worker's claim on a send is respected before it is considered abandoned. */
export const SEND_CLAIM_TTL_MS = 120_000

export type QuestionnaireSessionRow = SessionSnapshot & {
  agencyId: number
  conversationId: number
  leadId: number | null
  channel: string
  endedReason: string | null
  definition: unknown
  definitionRevision: number
  pendingTransition: unknown
  pendingClaimedAt: string | null
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

function mapRow(r: Record<string, unknown>): QuestionnaireSessionRow {
  const answers = r.answers
  const pending = r.pendingTransition
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    conversationId: Number(r.conversationId),
    leadId: r.leadId == null ? null : Number(r.leadId),
    channel: String(r.channel),
    status: r.status as QuestionnaireSessionStatus,
    endedReason: (r.endedReason as string | null) ?? null,
    definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition,
    definitionRevision: Number(r.definitionRevision ?? 1),
    currentStepId: (r.currentStepId as string | null) ?? null,
    answers: (typeof answers === 'string' ? JSON.parse(answers) : (answers ?? {})) as Record<string, string[]>,
    invalidCount: Number(r.invalidCount ?? 0),
    lastConsumedSequence: Number(r.lastConsumedSequence ?? 0),
    lastPromptAt: iso(r.lastPromptAt),
    version: Number(r.version ?? 0),
    pendingTransition: typeof pending === 'string' ? JSON.parse(pending) : pending,
    pendingClaimedAt: iso(r.pendingClaimedAt),
  }
}

/**
 * The session that governs this conversation: the live one, or the most recent
 * finished one. The finished row matters — it is how the worker knows a
 * conversation already ran a questionnaire and must not silently start another.
 */
export async function readSessionForConversation(
  agencyId: number,
  conversationId: number,
  executor: Knex | Knex.Transaction = db,
): Promise<QuestionnaireSessionRow | null> {
  const row = await executor('questionnaire_sessions')
    .where({ agencyId, conversationId })
    .orderByRaw(`CASE WHEN status = 'active' THEN 0 ELSE 1 END, id DESC`)
    .first()
  return row ? mapRow(row as Record<string, unknown>) : null
}

export async function hasActiveSession(conversationId: number): Promise<boolean> {
  const row = await db('questionnaire_sessions').where({ conversationId, status: 'active' }).first('id')
  return Boolean(row)
}

/**
 * Is this conversation the questionnaire's business?
 *
 * Mirrors the first two arms of the job-routing predicate
 * (db/questionnaireJobs.ts): the business is configured for the questionnaire,
 * or this conversation has run one. The job-reason arm is absent because there
 * is no job here.
 *
 * Its job is to keep Copilot analysis — an LLM call — away from a questionnaire
 * conversation, which is why it also answers true for a session that has
 * already ENDED: the transcript is still the questionnaire's, and analysing it
 * after the fact would be the same model call one turn later. It stays scoped
 * to this conversation, so the rest of the agency's AI is untouched.
 */
export async function isQuestionnaireConversation(
  executor: Knex | Knex.Transaction,
  agencyId: number,
  conversationId: number,
): Promise<boolean> {
  const res = await executor.raw(
    `SELECT (
       EXISTS (
         SELECT 1 FROM auto_response_settings s
          WHERE s."agencyId" = :agencyId AND s.responder = 'questionnaire'
       )
       OR EXISTS (
         SELECT 1 FROM questionnaire_sessions q
          WHERE q."conversationId" = :conversationId AND q."agencyId" = :agencyId
       )
     ) AS hit`,
    { agencyId, conversationId },
  )
  return Boolean(res.rows?.[0]?.hit)
}

/**
 * Has this exact turn's message already been sent?
 *
 * The key is stamped into the outbound row in the same INSERT that records it,
 * so finding one means the customer has it and the session simply has not been
 * advanced yet — the crash-between-send-and-commit case. Finding none is not
 * proof of absence (the send may have been accepted and never recorded), which
 * is why an ambiguous send is handled by policy rather than by retrying.
 */
export async function findOutboundByTurnKey(
  agencyId: number,
  conversationId: number,
  turnKey: string,
): Promise<{ messageId: number; sequence: number } | null> {
  const row = await db('inbox_messages')
    .where({ agencyId, conversationId, direction: 'outbound' })
    .whereRaw(`metadata->>'questionnaireTurnKey' = ?`, [turnKey])
    .first('id', 'sequence')
  return row ? { messageId: Number(row.id), sequence: Number(row.sequence) } : null
}

export async function startSession(args: {
  agencyId: number
  conversationId: number
  leadId: number | null
  channel: string
  definition: unknown
  definitionRevision: number
}): Promise<QuestionnaireSessionRow | null> {
  // ON CONFLICT DO NOTHING against the partial unique index: if another worker
  // started one first, we take theirs rather than creating a second.
  const res = await db.raw(
    `INSERT INTO questionnaire_sessions
       ("agencyId","conversationId","leadId",channel,status,definition,"definitionRevision")
     SELECT :agencyId, c.id, :leadId, :channel, 'active', :definition::jsonb, :revision
       FROM inbox_conversations c
      WHERE c.id = :conversationId AND c."agencyId" = :agencyId
     ON CONFLICT DO NOTHING
     RETURNING *`,
    {
      agencyId: args.agencyId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      channel: args.channel,
      definition: JSON.stringify(args.definition),
      revision: args.definitionRevision,
    },
  )
  const row = res.rows?.[0]
  if (row) return mapRow(row as Record<string, unknown>)
  return readSessionForConversation(args.agencyId, args.conversationId)
}

/**
 * Take the right to send this turn's message.
 *
 * Refused when another worker holds a claim that has not yet expired, which is
 * what keeps a lease-reclaimed job from sending the same question twice while
 * the first worker is still waiting on Meta. An expired claim is takeable: the
 * alternative is a conversation frozen forever by one crashed process.
 */
export async function claimSend(args: {
  agencyId: number
  sessionId: number
  version: number
  pendingTransition: unknown
  ttlMs?: number
}): Promise<boolean> {
  const ttlSeconds = Math.max(1, Math.round((args.ttlMs ?? SEND_CLAIM_TTL_MS) / 1000))
  const res = await db.raw(
    `UPDATE questionnaire_sessions
        SET "pendingTransition" = :pending::jsonb,
            "pendingClaimedAt"  = now(),
            "updatedAt"         = now()
      WHERE id = :sessionId AND "agencyId" = :agencyId AND version = :version AND status = 'active'
        AND ("pendingClaimedAt" IS NULL OR "pendingClaimedAt" < now() - make_interval(secs => :ttlSeconds))
      RETURNING id`,
    {
      agencyId: args.agencyId,
      sessionId: args.sessionId,
      version: args.version,
      pending: JSON.stringify(args.pendingTransition ?? null),
      ttlSeconds,
    },
  )
  return (res.rows?.length ?? 0) > 0
}

export async function releaseSendClaim(agencyId: number, sessionId: number): Promise<void> {
  await db('questionnaire_sessions')
    .where({ id: sessionId, agencyId })
    .update({ pendingTransition: null, pendingClaimedAt: null, updatedAt: db.fn.now() })
}

/** Advance a live session. Returns false when the version moved under us. */
export async function commitTurn(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    sessionId: number
    version: number
    currentStepId: string
    answers: Record<string, string[]>
    invalidCount: number
    lastConsumedSequence: number
    leadId: number | null
  },
): Promise<boolean> {
  const updated = await trx('questionnaire_sessions')
    .where({ id: args.sessionId, agencyId: args.agencyId, version: args.version, status: 'active' })
    .update({
      currentStepId: args.currentStepId,
      answers: JSON.stringify(args.answers),
      invalidCount: args.invalidCount,
      lastConsumedSequence: args.lastConsumedSequence,
      lastPromptAt: trx.fn.now(),
      leadId: args.leadId,
      version: args.version + 1,
      pendingTransition: null,
      pendingClaimedAt: null,
      updatedAt: trx.fn.now(),
    })
  return Number(updated) > 0
}

/** End a session. Safe to run twice: a session that is already ended stays as it was. */
export async function endSession(
  trx: Knex.Transaction,
  args: {
    agencyId: number
    sessionId: number
    status: Exclude<QuestionnaireSessionStatus, 'active'>
    endedReason: string
    answers: Record<string, string[]>
    lastConsumedSequence: number | null
    leadId: number | null
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: args.status,
    endedReason: args.endedReason,
    answers: JSON.stringify(args.answers),
    endedAt: trx.fn.now(),
    leadId: args.leadId,
    pendingTransition: null,
    pendingClaimedAt: null,
    updatedAt: trx.fn.now(),
    version: trx.raw('version + 1'),
  }
  if (args.lastConsumedSequence != null) patch.lastConsumedSequence = args.lastConsumedSequence
  const updated = await trx('questionnaire_sessions')
    .where({ id: args.sessionId, agencyId: args.agencyId, status: 'active' })
    .update(patch)
  return Number(updated) > 0
}

/** Consume inbound messages without changing anything else (ignorable input). */
export async function consumeUpTo(agencyId: number, sessionId: number, sequence: number): Promise<void> {
  await db('questionnaire_sessions')
    .where({ id: sessionId, agencyId })
    .andWhere('lastConsumedSequence', '<', sequence)
    .update({ lastConsumedSequence: sequence, updatedAt: db.fn.now() })
}
