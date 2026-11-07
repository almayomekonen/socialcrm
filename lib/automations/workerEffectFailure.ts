import type { AutomationJob } from '@/db/automations/jobs'
import { isTerminalWhatsappAccountError } from '@/lib/inbox/onWhatsappSendFailure'
import { FAILURE_COPY } from './copy'
import { isExecutionOutcomeUnknownError, isExecutionSkippedError } from './executors/types'
import type { AutomationsSendMode } from './flags'
import type { WorkerDeps } from './workerDeps'

export type EffectFailureOutcome = 'skipped' | 'dead' | 'retried'

type TransitionLog = (transition: string, job: AutomationJob, extra?: Record<string, unknown>) => void

/**
 * How a job ends when its executor threw AFTER the once-ever send claim was
 * taken (extracted from worker.ts unchanged; ADR-011 still governs it).
 *
 * An UNKNOWN outcome (`ExecutionOutcomeUnknownError`: the provider may have
 * accepted the message) is the one exception to releasing: the claim is KEPT and
 * the job is dead, exactly as for an unconfirmed claim after a crash (ADR-011),
 * so neither a retry nor a later trigger can send it twice.
 *
 * Otherwise the claim is released first, so a retry can re-claim. Then, in order:
 *  - a law refusal at the last moment (`ExecutionSkippedError`, e.g. the lead
 *    opted out after the law check) is a final skip, never a retry;
 *  - a terminal account error is dead immediately;
 *  - anything else is retried until the attempts are exhausted, then dead.
 */
export async function settleEffectFailure(args: {
  job: AutomationJob
  err: unknown
  mode: AutomationsSendMode
  leadName: string | null
  deps: WorkerDeps
  log: TransitionLog
}): Promise<EffectFailureOutcome> {
  const { job, err, mode, leadName, deps, log } = args
  const base = {
    agencyId: job.agencyId,
    automationId: job.automationId,
    leadId: job.leadId,
    leadName,
    mode,
    trigger: job.trigger,
    origin: job.origin,
  }

  if (isExecutionOutcomeUnknownError(err)) {
    await deps.deadJob(job.id, 'send_outcome_unknown')
    await deps.appendActivity({ ...base, kind: 'failed' })
    log('dead', job, { reason: 'send_outcome_unknown', class: 'ambiguous', userVisible: true, copy: FAILURE_COPY.terminal })
    return 'dead'
  }

  await deps.releaseClaim(job.automationId, job.leadId)

  if (isExecutionSkippedError(err)) {
    await deps.appendActivity({ ...base, kind: 'skipped', skipReason: err.reason })
    await deps.skipJob(job.id, err.reason)
    log('skipped', job, { reason: err.reason, class: 'law', userVisible: true })
    return 'skipped'
  }

  if (isTerminalWhatsappAccountError(err)) {
    await deps.deadJob(job.id, String(err))
    await deps.appendActivity({ ...base, kind: 'failed' })
    log('dead', job, { reason: String(err), class: 'whatsapp_account', userVisible: true, copy: FAILURE_COPY.terminal })
    return 'dead'
  }

  await deps.failJob(job.id, String(err))
  if (job.attempts >= job.maxAttempts) {
    await deps.appendActivity({ ...base, kind: 'failed' })
    log('dead', job, {
      reason: String(err),
      class: 'exhausted',
      attempts: job.attempts,
      userVisible: true,
      copy: FAILURE_COPY.terminal,
    })
    return 'dead'
  }
  log('retried', job, { reason: String(err), class: 'transient', attempts: job.attempts })
  return 'retried'
}
