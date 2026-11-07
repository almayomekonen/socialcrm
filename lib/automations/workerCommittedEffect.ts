import type { AutomationJob } from '@/db/automations/jobs'
import type { ExecutionOutcome } from './executors/types'
import type { AutomationsSendMode } from './flags'
import type { WorkerDeps } from './workerDeps'

type TransitionLog = (transition: string, job: AutomationJob, extra?: Record<string, unknown>) => void

type OutcomeArgs = {
  job: AutomationJob
  mode: AutomationsSendMode
  leadName: string | null
  contentSchemaVersion: number
  outcome: ExecutionOutcome
}

/** The activity row an execute() outcome records. One shape for both paths. */
export function outcomeActivity({ job, mode, leadName, contentSchemaVersion, outcome }: OutcomeArgs) {
  return {
    agencyId: job.agencyId,
    automationId: job.automationId,
    leadId: job.leadId,
    leadName,
    kind: outcome.kind,
    // A `would_send` row is always mode 'log' — it records that no external
    // effect occurred, whatever the engine's configured mode was.
    mode: outcome.kind === 'sent' ? mode : ('log' as const),
    trigger: job.trigger,
    origin: job.origin,
    subject: outcome.summary,
    deliveryState: outcome.deliveryState ?? null,
    providerMessageId: outcome.providerMessageId ?? null,
    contentSchemaVersion,
  }
}

/**
 * How a job ends once its effect HAS HAPPENED: the provider accepted the message
 * and returned its id. That is irreversible, so nothing below may release the
 * once-ever claim or let the job run again — whatever fails.
 *
 *   1. confirm the claim first, the earliest durable "this lead has it";
 *   2. record the `sent` activity;
 *   3. complete the job.
 *
 * Each step is attempted on its own and a failure never stops the others. If any
 * step failed — or the executor already reported one (`failedStep`, e.g. the
 * message could not be persisted) — the job is DEAD with every missing step and
 * the provider message id in `lastError`, and a `post_send_incomplete` line is
 * logged, so the gap is visible and recoverable by hand. Never retried, never
 * reported as a clean success.
 *
 * Even if those writes fail too, nothing can resend: the claim is `confirmed`
 * (already_sent) or still `claimed` (ambiguous_after_crash, ADR-011), and a job
 * left `processing` is reclaimed into exactly one of those two branches.
 */
export async function settleCommittedEffect(
  args: OutcomeArgs & { failedStep?: string | null; deps: WorkerDeps; log: TransitionLog },
): Promise<'done' | 'dead'> {
  const { job, outcome, deps, log } = args
  const incomplete: string[] = args.failedStep ? [args.failedStep] : []
  const attempt = async (step: string, run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run()
      return true
    } catch (err) {
      incomplete.push(step)
      log('post_send_step_failed', job, { step, error: (err as Error)?.name ?? 'unknown', class: 'post_send_incomplete' })
      return false
    }
  }

  await attempt('confirm_claim', () => deps.confirmClaim(job.automationId, job.leadId))
  await attempt('append_activity', () => deps.appendActivity(outcomeActivity(args)))
  log(outcome.kind, job, outcome.log)

  if (incomplete.length === 0 && (await attempt('complete_job', () => deps.completeJob(job.id)))) {
    log('done', job, { reason: 'sent' })
    return 'done'
  }

  const providerMessageId = outcome.providerMessageId ?? null
  const reason = `post_send_incomplete: ${incomplete.join(',')}${providerMessageId ? ` providerMessageId=${providerMessageId}` : ''}`
  await attempt('dead_job', () => deps.deadJob(job.id, reason))
  log('dead', job, { reason, class: 'post_send_incomplete', incomplete, providerMessageId, userVisible: true })
  return 'dead'
}
