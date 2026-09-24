/**
 * Close the loop on a customer message that arrived while a turn was running.
 *
 * THE GAP. `auto_response_jobs_inflight_uniq` allows one pending/processing job
 * per conversation, which is what makes several rapid messages collapse into one
 * coherent reply. But the worker reads its transcript once, at the start. A
 * message that lands after that read and before the job settles is refused by
 * the index (`ON CONFLICT DO NOTHING` returns null), so no job ever covers it —
 * and the minute-ly cron only claims jobs that already exist, so nothing
 * recovers it. The customer's last message is simply never answered.
 *
 * THE FIX. When a job settles, compare the conversation's newest message against
 * the sequence that job actually covered. If a newer inbound exists, enqueue one
 * more turn for it. Deterministic and immediate, rather than hoping a sweeper
 * happens to notice.
 *
 * WHY THIS TERMINATES. Each follow-up job's triggerSequence is the newest
 * INBOUND sequence at the moment it is created. After it settles, that sequence
 * is unchanged unless the customer wrote again — in which case another turn is
 * exactly what should happen. There is no state in which the condition stays
 * true without new customer input.
 *
 * WHY IT MAY OVER-FIRE, AND WHY THAT IS THE RIGHT DIRECTION. When the message
 * did reach the worker's transcript in time, this still enqueues one follow-up.
 * That job is claimed, finds no unanswered inbound, and skips at
 * `decidePreGeneration` — before any model call or send. The cost is one cheap
 * claim; the alternative error is a customer message nobody ever answers.
 *
 * WHY SOME OUTCOMES DO NOT RE-ENQUEUE. A conversation that stopped for a
 * terminal reason — the customer opted out, a human took over, the lead closed,
 * the feature is off — must not have a fresh job created for it. The follow-up
 * would be claimed only to skip for the same reason, burning a worker slot and
 * filling the job table with noise. `daily_cap` is included for the same
 * practical reason: the turn is already lost to the cap.
 */
import type { Knex } from 'knex'
import { enqueueAutoResponse, type AutoResponseReason } from '@/db/autoResponseJobs'

/** Reasons whose conversation is finished, or whose retry is pointless today. */
export const NON_RESUMABLE_SKIP_REASONS: ReadonlySet<string> = new Set([
  'opt_out',
  'opted_out',
  'human_active',
  'personal',
  'lead_terminal',
  'lead_gone',
  'conversation_gone',
  'conversation_missing',
  'feature_off',
  'channel_off',
  'already_escalated',
  'closed',
  'qualifier_killed',
  'daily_cap',
  'no_connection',
  'no_recipient',
])

export type LatestInbound = { sequence: number } | null | undefined

export interface FollowUpFacts {
  /**
   * The conversation's newest INBOUND message — not its newest message.
   *
   * This distinction is the whole correctness argument. The agent's reply is
   * persisted at a HIGHER sequence than the customer message that arrived
   * mid-turn, so "is the latest message inbound?" answers false exactly when a
   * message was dropped. Sequence order cannot tell "already answered" from
   * "arrived before the reply was written", so the condition has to be the one
   * that never loses a customer message: did any inbound arrive after the
   * sequence this turn was created for?
   */
  latestInbound: LatestInbound
  /** The sequence the job that just settled was created for. */
  coveredSequence: number
  /** How that job ended. */
  outcome: 'sent' | 'skipped' | 'failed' | 'deferred' | 'error'
  /** Its final skipReason, when it skipped. */
  skipReason?: string | null
  /** The settled job's reason — no_response_* jobs never spawn a follow-up turn. */
  jobReason: AutoResponseReason
}

export type FollowUpDecision =
  | { enqueue: true; triggerSequence: number }
  | { enqueue: false; reason: string }

const TURN_JOB_REASONS: ReadonlySet<string> = new Set(['first_contact', 'qualify_turn', 'questionnaire_turn'])

export function decideFollowUpTurn(f: FollowUpFacts): FollowUpDecision {
  // A questionnaire turn takes the same follow-up rule as a qualify turn: a
  // message that landed while the turn was running is covered by no job, and
  // one more turn is exactly what should happen. It terminates for the same
  // reason — the trigger sequence only moves when the customer writes again.
  if (!TURN_JOB_REASONS.has(f.jobReason)) {
    return { enqueue: false, reason: 'not_a_turn_job' }
  }
  if (f.outcome === 'failed' || f.outcome === 'error') {
    // The job itself will be retried by the existing attempts/lease machinery,
    // and it still covers the newer message once it re-reads the transcript.
    return { enqueue: false, reason: 'job_will_retry' }
  }
  if (f.outcome === 'skipped' && f.skipReason && NON_RESUMABLE_SKIP_REASONS.has(f.skipReason)) {
    return { enqueue: false, reason: `terminal_${f.skipReason}` }
  }
  const latestInbound = f.latestInbound
  if (!latestInbound) return { enqueue: false, reason: 'no_inbound' }
  const seq = Number(latestInbound.sequence)
  if (!Number.isFinite(seq)) return { enqueue: false, reason: 'bad_sequence' }
  if (seq <= Number(f.coveredSequence)) return { enqueue: false, reason: 'already_covered' }
  return { enqueue: true, triggerSequence: seq }
}

/** The conversation's newest INBOUND message, for {@link decideFollowUpTurn}. */
export async function readLatestInbound(
  trx: Knex.Transaction,
  conversationId: number,
): Promise<LatestInbound> {
  const row = await trx('inbox_messages')
    .where({ conversationId, direction: 'inbound' })
    .orderBy([
      { column: 'sequence', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .first('sequence')
  return row ? { sequence: Number(row.sequence) } : null
}

export type FollowUpJobContext = {
  agencyId: number
  conversationId: number
  leadId: number | null
  channel: string
  reason: AutoResponseReason
  triggerSequence: number
}

/**
 * Enqueue the follow-up turn if one is owed. Returns the new job id, or null.
 *
 * Runs inside a transaction and reuses `enqueueAutoResponse`, so it inherits
 * every existing guard: the agency/channel enabled check, the first-contact
 * single-job rule, and the in-flight unique index. If a job was somehow created
 * in the meantime, `ON CONFLICT DO NOTHING` makes this a no-op.
 */
export async function enqueueFollowUpTurnIfOwed(
  trx: Knex.Transaction,
  job: FollowUpJobContext,
  settled: { outcome: FollowUpFacts['outcome']; skipReason?: string | null },
): Promise<{ jobId: number | null; decision: FollowUpDecision }> {
  const latestInbound = await readLatestInbound(trx, job.conversationId)
  const decision = decideFollowUpTurn({
    latestInbound,
    coveredSequence: job.triggerSequence,
    outcome: settled.outcome,
    skipReason: settled.skipReason ?? null,
    jobReason: job.reason,
  })
  if (decision.enqueue === false) return { jobId: null, decision }

  const jobId = await enqueueAutoResponse(trx, {
    agencyId: job.agencyId,
    conversationId: job.conversationId,
    leadId: job.leadId,
    channel: job.channel,
    triggerSequence: decision.triggerSequence,
    // Keep the settled job's own reason rather than forcing a continuation
    // turn. That hands the decision back to the guards that already exist, and
    // they get both modes right without a special case here:
    //
    //   · acknowledge / 'first_contact' — if the previous job SENT, the
    //     single-job guard refuses this follow-up, so the one-shot promise
    //     holds. If it skipped transiently (a rep was typing), no sent job
    //     exists, the follow-up is allowed, and the message that landed
    //     mid-turn finally gets answered instead of vanishing.
    //   · qualify / 'qualify_turn' — no single-job guard, so the follow-up is
    //     created and the conversation continues.
    reason: job.reason,
    delaySeconds: 0,
  })
  return { jobId, decision }
}
