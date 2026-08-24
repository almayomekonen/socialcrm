/**
 * Per-turn conversation classification — durable record of how the AI Qualifier
 * read one customer turn.
 *
 * Write-only observability. Nothing in the send path reads this module, so it can
 * never affect a customer message. The worker's call site wraps `recordTurnClassification`
 * so a failure here is logged and dropped, exactly as `insertQualifyDraftReview`
 * already is in the same file.
 *
 * The whole persistence implementation lives here rather than in the worker:
 * `qualifyWorker.ts` is already far past the file-size limit, so A3 adds one
 * guarded call there and nothing else.
 *
 * KNOWN LIMITATION — first-write-wins. A job that fails is returned to 'pending'
 * on the SAME row (`failAutoResponseJob`), and an expired lease does the same
 * (`reclaimStaleAutoResponseJobs`), so one `triggerSequence` can be processed more
 * than once. The unique index keeps the FIRST classification. In the narrow window
 * where an attempt classifies and then dies before `completeAutoResponseJob`, and a
 * new inbound message arrives before the retry, the stored row reflects the attempt
 * that did not send. `jobId` and `attempt` make that case attributable. One stable
 * row per turn is worth more to this table's purpose than perfect attempt fidelity.
 *
 * Note that a generation failure returns from the worker BEFORE the convergence
 * point, so the ordinary retry — provider outage, then a successful second
 * attempt — writes exactly once.
 */
import { db } from '@/config/db'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import type { PostDecision } from '@/lib/inbox/autoresponse/stateMachine'
import type { ResponseProfile } from '@/lib/inbox/autoresponse/responseProfile'
import type { SalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import type { SalesStrategy } from '@/lib/inbox/autoresponse/qualification'

export const TURN_CLASSIFICATION_TABLE = 'conversation_turn_classification'

/**
 * The job fields this log needs. Taking the job itself rather than six loose
 * numbers keeps the worker's call site to the values only IT knows, and keeps
 * `leadId` the one the worker actually acted on — `worker.ts` may resolve it from
 * the conversation after the job row was written.
 */
export type TurnClassificationJob = Pick<
  AutoResponseJob,
  'id' | 'agencyId' | 'conversationId' | 'leadId' | 'triggerSequence' | 'attempts'
>

/** Everything the convergence point knows, in the worker's own terms. */
export interface TurnClassificationInput {
  job: TurnClassificationJob
  salesMove: SalesMove
  salesStrategy: SalesStrategy
  responseProfile: ResponseProfile
  hotSignal: boolean
  uncertain: boolean
  /** The final send/escalate decision, after the guardrail override. */
  decision: PostDecision
  /** True when the canary suppressed the send. */
  draft: boolean
  /** The turn number this classification produced. */
  turnCount: number
  model?: string | null
}

/** One flat row. Every classification field is a bounded enum, so none are jsonb. */
export interface TurnClassificationRow {
  agencyId: number
  conversationId: number
  leadId: number | null
  triggerSequence: number
  jobId: number
  attempt: number
  salesMove: string
  salesStrategy: string
  tone: string
  emotion: string
  urgency: string
  language: string
  customerStyle: string
  establishedTone: string
  vocative: string | null
  hotSignal: boolean
  uncertain: boolean
  decision: 'send' | 'escalate'
  escalationReason: string | null
  draft: boolean
  turnCount: number
  model: string | null
}

/**
 * Pure mapping from the worker's values to the row. No I/O, so the shape is
 * testable without a database — including the two fields that are easiest to get
 * wrong: `escalationReason`, which exists only on the escalate branch, and
 * `draft`, without which canary turns that were never sent would silently pollute
 * every aggregate.
 */
export function buildTurnClassification(input: TurnClassificationInput): TurnClassificationRow {
  const { responseProfile: p, decision, job } = input
  return {
    agencyId: job.agencyId,
    conversationId: job.conversationId,
    leadId: job.leadId,
    triggerSequence: job.triggerSequence,
    jobId: job.id,
    attempt: job.attempts,
    salesMove: input.salesMove,
    salesStrategy: input.salesStrategy,
    tone: p.tone,
    emotion: p.emotion,
    urgency: p.urgency,
    language: p.language,
    customerStyle: p.customerStyle,
    establishedTone: p.establishedTone,
    vocative: p.vocative ?? null,
    hotSignal: input.hotSignal,
    uncertain: input.uncertain,
    decision: decision.action,
    escalationReason: decision.action === 'escalate' ? decision.reason : null,
    draft: input.draft,
    turnCount: input.turnCount,
    model: input.model ?? null,
  }
}

/**
 * The insert, as a query builder so the conflict target is assertable in a test
 * without a database. Removing `.ignore()` or changing the target changes the SQL
 * this returns — which is the only way that guarantee can be defended, since a
 * mocked writer would happily accept either.
 */
export function turnClassificationInsertQuery(row: TurnClassificationRow) {
  return db(TURN_CLASSIFICATION_TABLE).insert(row).onConflict(['conversationId', 'triggerSequence']).ignore()
}

/** Record one turn's classification. First write for a turn wins. */
export async function recordTurnClassification(input: TurnClassificationInput): Promise<void> {
  await turnClassificationInsertQuery(buildTurnClassification(input))
}
