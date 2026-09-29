/**
 * The questionnaire drain.
 *
 * Deliberately a sibling of `runAutoResponseWorker`, not a fork of it: same
 * table, same lease, same backoff, same follow-up rule. What differs is the
 * claim — it takes only questionnaire work (db/questionnaireJobs.ts) — and what
 * it calls, which has no model in it anywhere.
 *
 * Both workers run from the same minute-ly cron and the same webhook kick.
 * Because a claim is one atomic status change, a job can only ever be taken by
 * one of them.
 */
import { db } from '@/config/db'
import { failAutoResponseJob, reclaimStaleAutoResponseJobs } from '@/db/autoResponseJobs'
import { claimQuestionnaireJobs } from '@/db/questionnaireJobs'
import { sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { enqueueFollowUpTurnIfOwed } from '../followUpTurn'
import { waTrace } from '../waTrace'
import { processQuestionnaireJob } from './processJob'
import type { QuestionnaireDeps, QuestionnaireOutcome } from './types'

const DEFAULT_LEASE_MS = 60_000

export type QuestionnaireWorkerResult = {
  claimed: number
  sent: number
  skipped: number
  failed: number
  deferred: number
}

export async function runQuestionnaireWorker(
  opts: { limit?: number; leaseMs?: number; workerId?: string; deps?: Partial<QuestionnaireDeps> } = {},
): Promise<QuestionnaireWorkerResult> {
  const limit = opts.limit ?? 5
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const workerId = opts.workerId ?? `qw-${process.pid}-${Date.now()}`
  const deps: QuestionnaireDeps = { send: opts.deps?.send ?? sendWhatsappText, sendInteractive: opts.deps?.sendInteractive }

  await reclaimStaleAutoResponseJobs(leaseMs)
  const jobs = await claimQuestionnaireJobs(workerId, limit)
  if (jobs.length) console.log(`[questionnaire] worker start id=${workerId} claimed=${jobs.length}`)

  let sent = 0
  let skipped = 0
  let failed = 0
  let deferred = 0

  for (const job of jobs) {
    const startedAt = Date.now()
    let outcome: QuestionnaireOutcome | 'error' = 'error'
    try {
      outcome = await processQuestionnaireJob(job, deps)
      if (outcome === 'sent') sent++
      else if (outcome === 'skipped') skipped++
      else if (outcome === 'deferred') deferred++
      else failed++
    } catch (err) {
      await failAutoResponseJob(job.id, String(err))
      failed++
    } finally {
      try {
        const fin = await db('auto_response_jobs').where({ id: job.id }).first('status', 'skipReason')
        // A message that landed while this turn was running is covered by no
        // job, because the in-flight unique index refused it. Same closing of
        // the loop as the agent's worker, and it terminates for the same
        // reason: the trigger sequence only moves when the customer writes.
        const followUp = await db.transaction((trx) =>
          enqueueFollowUpTurnIfOwed(
            trx,
            {
              agencyId: job.agencyId,
              conversationId: job.conversationId,
              leadId: job.leadId,
              channel: job.channel,
              reason: job.reason,
              triggerSequence: job.triggerSequence,
            },
            { outcome: outcome === 'error' ? 'error' : outcome, skipReason: (fin?.skipReason as string | null) ?? null },
          ),
        )
        waTrace(
          'QUESTIONNAIRE_JOB_FINISHED',
          { conversationId: job.conversationId, jobId: job.id, agencyId: job.agencyId, triggerSequence: job.triggerSequence },
          {
            outcome,
            finalStatus: fin?.status ?? null,
            skipReason: fin?.skipReason ?? null,
            durationMs: Date.now() - startedAt,
            followUpJobId: followUp?.jobId ?? null,
          },
        )
      } catch (bookkeepingErr) {
        console.error('[questionnaire] post-job bookkeeping failed', {
          jobId: job.id,
          reason: (bookkeepingErr as Error)?.message,
        })
      }
    }
  }

  return { claimed: jobs.length, sent, skipped, failed, deferred }
}
