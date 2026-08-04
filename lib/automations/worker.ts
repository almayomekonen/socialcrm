import { startOfBusinessDayMs } from '@/lib/today/time'
import {
  claimAutomationJobs,
  completeAutomationJob,
  deadAutomationJob,
  failAutomationJob,
  reclaimStaleAutomationJobs,
  skipAutomationJob,
  type AutomationJob,
} from '@/db/automations/jobs'
import { claimSendOnce, confirmSendClaim, getSendClaimState, releaseSendClaim } from '@/db/automations/claims'
import {
  appendActivity,
  countAutomatedTodayForAgency,
  countAutomatedTodayForLead,
  hasConsumingActivity,
} from '@/db/automations/activity'
import { CONTENT_SCHEMA_VERSION, getDefinitionForWorker, type WorkerDefinition } from '@/db/automations/definitions'
import { getAgencyName, getLeadFacts, getRepName, type LeadFacts } from '@/db/automations/leadFacts'
import { getMeetingFacts } from '@/db/automations/meetingFacts'
import { MISSING_MEETING, meetingIdFromOccurrenceKey, type MeetingFacts } from './appointments'
import { isLeadSuppressed } from '@/db/automations/suppressions'
import { isRecipientBlocked } from './recipientBlocks'
import { decideSendForAction, type SendFacts } from './laws'
import type { Condition } from './conditions'
import { isValidTiming } from './timing'
import { FAILURE_COPY } from './copy'
import { recipientFieldFor, type SubjectValues } from './subject'
import { defaultWorkerDeps, type WorkerDeps } from './workerDeps'
import { appointmentFactsFor, leadMessagesTodayFor, recipientFacts, resolveSubjectContext } from './workerFacts'
import type { AnyActionExecutor } from './executors/types'
import type { EventDefinition } from './catalog/types'
import { getAutomationsSendMode, type AutomationsSendMode } from './flags'
import { getAction, getEvent } from './catalog/registry'
import { eventKeyForEngineTrigger } from './catalog/engineBridge'
import { liveFieldKeys } from './conditionEvaluator'
import { actionKeyFor, actionParameters } from './actionEntry'
import { executorFor } from './executors/registry'
import type { ExecutionContext } from './executors/types'
import type { ActionDefinition } from './catalog/types'

/**
 * The engine worker — ADR-011 is the contract; this file is the machine.
 * pending → processing (claim) → done | skipped | retried(pending) | dead.
 * Effect order is law: claim → effect → confirm → complete. Every transition
 * logs structurally with an explicit reason; no job ends silently.
 *
 * B5: this file no longer knows what an email is. It resolves the automation's
 * ACTION, composes that action's law pipeline, and hands the effect to that
 * action's executor. Email is Action #1, not a special engine — the only
 * reason `send` still appears in WorkerDeps is that executors draw their
 * capabilities from the same injected record.
 */

const LOG = '[automations][worker]'
const LEASE_MS = 60_000

export { defaultWorkerDeps, type WorkerDeps }

type Outcome = 'done' | 'skipped' | 'retried' | 'dead'
export type WorkerSummary = { claimed: number; done: number; skipped: number; retried: number; dead: number }

function logT(transition: string, job: AutomationJob, extra: Record<string, unknown> = {}): void {
  console.log(LOG, {
    transition,
    jobId: job.id,
    automationId: job.automationId,
    agencyId: job.agencyId,
    leadId: job.leadId,
    ...extra,
  })
}

async function processJob(job: AutomationJob, deps: WorkerDeps): Promise<Outcome> {
  const mode = deps.sendMode()
  const jobSkip = async (reason: string): Promise<Outcome> => {
    await deps.skipJob(job.id, reason)
    logT('skipped', job, { reason, userVisible: false })
    return 'skipped'
  }

  const def = await deps.getDefinition(job.automationId)
  if (!def || def.agencyId !== job.agencyId) return jobSkip('definition_missing')
  if (def.status !== 'active') return jobSkip('definition_inactive') // ADR-011's quiet exception
  if (def.content?.schemaVersion !== CONTENT_SCHEMA_VERSION || !isValidTiming(def.content.timing)) {
    return jobSkip('definition_invalid_content') // unknown concept ⇒ inert (ADR-008)
  }

  const lead = await deps.getLeadFacts(job.agencyId, job.leadId)
  const claimState = await deps.claimState(job.automationId, job.leadId)

  // Crash recovery (ADR-011): an unconfirmed claim from a prior attempt.
  if (claimState === 'claimed') {
    if (mode === 'live') {
      await deps.appendActivity({
        agencyId: job.agencyId,
        automationId: job.automationId,
        leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed',
        mode,
        trigger: job.trigger,
        origin: job.origin,
      })
      await deps.deadJob(job.id, 'ambiguous_after_crash')
      logT('dead', job, { reason: 'ambiguous_after_crash', class: 'ambiguous', userVisible: true })
      return 'dead'
    }
    if (!(await deps.hasEffect(job.automationId, job.leadId))) {
      await deps.appendActivity({
        agencyId: job.agencyId,
        automationId: job.automationId,
        leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'would_send',
        mode: 'log',
        trigger: job.trigger,
        origin: job.origin,
        contentSchemaVersion: def.content.schemaVersion,
      })
      logT('recovered_effect', job, { reason: 'unconfirmed_claim_log_mode' })
    } else {
      logT('recovered_complete', job, { reason: 'effect_row_already_present' })
    }
    await deps.confirmClaim(job.automationId, job.leadId)
    await deps.completeJob(job.id)
    logT('done', job, { reason: 'recovered' })
    return 'done'
  }

  // The action is resolved from the definition, not assumed. A definition
  // naming an action the catalog does not describe, or that has no executor,
  // fails CLOSED with a user-visible reason rather than defaulting to email.
  const actionKey = actionKeyFor(def)
  const action = actionKey ? deps.getAction(actionKey) : null
  const executor = actionKey ? deps.executorFor(actionKey) : null

  const now = deps.now()
  const since = new Date(startOfBusinessDayMs(now.getTime()))
  const resolved = await resolveSubjectContext(job, def, lead, action, executor, deps)
  const appointment = await appointmentFactsFor(job, deps)

  const facts: SendFacts = {
    event: {
      trigger: job.trigger,
      origin: job.origin,
      agencyId: job.agencyId,
      leadId: job.leadId,
      occurredAt: new Date(job.createdAt),
    },
    premise: { definition: resolved.event, conditions: resolved.conditions, values: resolved.premise },
    lead: { exists: lead.exists, currentStatus: lead.exists ? lead.currentStatus : null },
    recipients: await recipientFacts(job.agencyId, resolved.recipients, deps),
    appointment,
    suppressed: await deps.isSuppressed(job.agencyId, job.leadId),
    optedOut: await deps.isOptedOut(job.agencyId, job.leadId),
    alreadySent: claimState === 'confirmed',
    // Every automated sender's messages, not just this engine's — see
    // leadMessagesTodayFor. This is what keeps the two subsystems from
    // double-texting one lead.
    sentToLeadToday: await leadMessagesTodayFor(job, since, deps),
    sentByAgencyToday: await deps.countAgencyToday(job.agencyId, since),
    quietHours: null, // no per-agency window config in V1 (folded 'מתקדם' arrives with Phase 6)
    now,
  }

  // The law layer asks "which subject field carries a recipient of this type?"
  // and the EVENT answers. Neither names a channel.
  const decision =
    action && executor
      ? decideSendForAction(action, facts, (type) => recipientFieldFor(resolved.event, type))
      : ({ allow: false, reason: 'action_unavailable' } as const)
  if ('reason' in decision) {
    const reason = decision.reason
    await deps.appendActivity({
      agencyId: job.agencyId,
      automationId: job.automationId,
      leadId: job.leadId,
      leadName: lead.exists ? lead.displayName : null,
      kind: 'skipped',
      mode,
      trigger: job.trigger,
      origin: job.origin,
      skipReason: reason,
    })
    await deps.skipJob(job.id, reason)
    logT('skipped', job, { reason, class: 'law', userVisible: true })
    return 'skipped'
  }

  // Preflight runs BEFORE the claim (ADR-013): a configuration fault is the
  // business's, not the lead's, and burning the lead's once-ever allowance on
  // it would mean the lead never gets the message even after the fix.
  const ctx: ExecutionContext = {
    agencyId: job.agencyId,
    automationId: job.automationId,
    leadId: job.leadId,
    mode,
    subject: resolved.subject,
    recipients: resolved.recipients,
    parameters: actionParameters(def),
  }

  // The executor's OWN dependencies — the worker declares none of them.
  const executorDeps = executor.defaultDeps()
  const pre = await executor.preflight(ctx, executorDeps)
  if (pre.problem) {
    // Log mode still produces a truthful preview; only a real effect is blocked.
    if (mode === 'live') {
      await deps.appendActivity({
        agencyId: job.agencyId,
        automationId: job.automationId,
        leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed',
        mode,
        trigger: job.trigger,
        origin: job.origin,
      })
      // Definitive, never retried — a retry storm cannot fix a misconfiguration.
      await deps.deadJob(job.id, pre.problem.deadReason)
      logT('dead', job, { reason: pre.problem.reason, class: pre.problem.logClass, userVisible: true })
      return 'dead'
    }
    logT(pre.problem.warnTransition, job, { reason: pre.problem.reason, class: pre.problem.logClass, blocking: false })
  }

  if (!(await deps.claimOnce({ agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId, mode }))) {
    await deps.appendActivity({
      agencyId: job.agencyId,
      automationId: job.automationId,
      leadId: job.leadId,
      leadName: lead.exists ? lead.displayName : null,
      kind: 'skipped',
      mode,
      trigger: job.trigger,
      origin: job.origin,
      skipReason: 'already_sent',
    })
    await deps.skipJob(job.id, 'already_sent')
    logT('skipped', job, { reason: 'already_sent', class: 'raced_claim', userVisible: true })
    return 'skipped'
  }

  // Claim held from here: any failure below releases it (retry re-claims).
  try {
    const outcome = await executor.execute(ctx, pre.ready, executorDeps)

    await deps.appendActivity({
      agencyId: job.agencyId,
      automationId: job.automationId,
      leadId: job.leadId,
      leadName: lead.exists ? lead.displayName : null,
      kind: outcome.kind,
      // A `would_send` row is always mode 'log' — it records that no external
      // effect occurred, whatever the engine's configured mode was.
      mode: outcome.kind === 'sent' ? mode : 'log',
      trigger: job.trigger,
      origin: job.origin,
      subject: outcome.summary,
      deliveryState: outcome.deliveryState ?? null,
      providerMessageId: outcome.providerMessageId ?? null,
      contentSchemaVersion: def.content.schemaVersion,
    })
    logT(outcome.kind, job, outcome.log)

    await deps.confirmClaim(job.automationId, job.leadId)
    await deps.completeJob(job.id)
    logT('done', job, { reason: mode === 'live' ? 'sent' : 'would_send' })
    return 'done'
  } catch (err) {
    await deps.releaseClaim(job.automationId, job.leadId)
    await deps.failJob(job.id, String(err))
    const exhausted = job.attempts >= job.maxAttempts
    if (exhausted) {
      await deps.appendActivity({
        agencyId: job.agencyId,
        automationId: job.automationId,
        leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed',
        mode,
        trigger: job.trigger,
        origin: job.origin,
      })
      logT('dead', job, {
        reason: String(err),
        class: 'exhausted',
        attempts: job.attempts,
        userVisible: true,
        copy: FAILURE_COPY.terminal,
      })
      return 'dead'
    }
    logT('retried', job, { reason: String(err), class: 'transient', attempts: job.attempts })
    return 'retried'
  }
}

export async function runAutomationWorker(opts?: {
  limit?: number
  workerId?: string
  deps?: WorkerDeps
}): Promise<WorkerSummary> {
  const deps = opts?.deps ?? defaultWorkerDeps()
  const limit = opts?.limit ?? 10
  const workerId = opts?.workerId ?? `worker-${process.pid}`
  const summary: WorkerSummary = { claimed: 0, done: 0, skipped: 0, retried: 0, dead: 0 }
  try {
    const reclaimed = await deps.reclaim(LEASE_MS)
    if (reclaimed > 0) console.log(LOG, { transition: 'reclaimed', count: reclaimed, reason: 'lease_expired' })
    const jobs = await deps.claim(workerId, limit)
    summary.claimed = jobs.length
    for (const job of jobs) {
      logT('claimed', job, { attempts: job.attempts, workerId })
      const outcome = await processJob(job, deps)
      summary[outcome === 'done' ? 'done' : outcome]++
    }
  } catch (err) {
    console.error(LOG, { transition: 'pass_failed', reason: String(err) })
  }
  console.log(LOG, { transition: 'pass_summary', ...summary, workerId })
  return summary
}
