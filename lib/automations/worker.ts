import { baseUrl } from '@/types/vars'
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
import { appendActivity, countAutomatedTodayForAgency, countAutomatedTodayForLead, hasConsumingActivity } from '@/db/automations/activity'
import { CONTENT_SCHEMA_VERSION, getDefinitionForWorker, type WorkerDefinition } from '@/db/automations/definitions'
import { getAgencyName, getAgencyReplyTo, getLeadFacts, getRepName, type LeadFacts } from '@/db/automations/leadFacts'
import { isLeadSuppressed } from '@/db/automations/suppressions'
import { isEmailBlocked } from '@/db/automations/emailBlocks'
import { decideSend, type SendFacts } from './laws'
import { resolveSenderIdentity } from './identity'
import { isValidTiming } from './timing'
import { FAILURE_COPY } from './copy'
import { getAutomationsFrom, getAutomationsSendMode, type AutomationsSendMode } from './flags'
import { renderAutomationEmail } from './renderEmail'
import { leadUnsubscribeUrl } from './unsubscribeToken'

/**
 * The engine worker — ADR-011 is the contract; this file is the machine.
 * pending → processing (claim) → done | skipped | retried(pending) | dead.
 * Effect order is law: claim → effect → confirm → complete. Every transition
 * logs structurally with an explicit reason; no job ends silently.
 */

const LOG = '[automations][worker]'
const LEASE_MS = 60_000

export type WorkerDeps = {
  sendMode: () => AutomationsSendMode
  reclaim: (leaseMs: number) => Promise<number>
  claim: (workerId: string, limit: number) => Promise<AutomationJob[]>
  getDefinition: (id: number) => Promise<WorkerDefinition | null>
  getLeadFacts: (agencyId: number, leadId: number) => Promise<LeadFacts>
  isSuppressed: (agencyId: number, leadId: number) => Promise<boolean>
  isBlocked: (agencyId: number, email: string) => Promise<boolean>
  claimState: (automationId: number, leadId: number) => Promise<'none' | 'claimed' | 'confirmed'>
  claimOnce: (args: { agencyId: number; automationId: number; leadId: number; mode: 'live' | 'log' }) => Promise<boolean>
  confirmClaim: (automationId: number, leadId: number) => Promise<void>
  releaseClaim: (automationId: number, leadId: number) => Promise<void>
  hasEffect: (automationId: number, leadId: number) => Promise<boolean>
  countLeadToday: (agencyId: number, leadId: number, since: Date) => Promise<number>
  countAgencyToday: (agencyId: number, since: Date) => Promise<number>
  appendActivity: typeof appendActivity
  agencyName: (agencyId: number) => Promise<string | null>
  replyTo: (agencyId: number) => Promise<string | null>
  repName: (userId: number | null) => Promise<string | null>
  send: (args: {
    from: string
    replyTo: string
    to: string
    subject: string
    html: string
    text: string
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  completeJob: (id: number) => Promise<void>
  skipJob: (id: number, reason: string) => Promise<void>
  failJob: (id: number, error: string) => Promise<void>
  deadJob: (id: number, error: string) => Promise<void>
  now: () => Date
}

export function defaultWorkerDeps(): WorkerDeps {
  return {
    sendMode: getAutomationsSendMode,
    reclaim: reclaimStaleAutomationJobs,
    claim: claimAutomationJobs,
    getDefinition: getDefinitionForWorker,
    getLeadFacts,
    isSuppressed: isLeadSuppressed,
    isBlocked: isEmailBlocked,
    claimState: getSendClaimState,
    claimOnce: claimSendOnce,
    confirmClaim: confirmSendClaim,
    releaseClaim: releaseSendClaim,
    hasEffect: hasConsumingActivity,
    countLeadToday: countAutomatedTodayForLead,
    countAgencyToday: countAutomatedTodayForAgency,
    appendActivity,
    agencyName: getAgencyName,
    replyTo: getAgencyReplyTo,
    repName: getRepName,
    // Transport is an effect-time concern (ADR-011): loaded lazily so the
    // log-mode engine never touches the Resend client (whose construction
    // requires the platform API key at import).
    send: async (args) => {
      const { sendEmail } = await import('@/lib/email/sender')
      return sendEmail(args)
    },
    completeJob: completeAutomationJob,
    skipJob: skipAutomationJob,
    failJob: failAutomationJob,
    deadJob: deadAutomationJob,
    now: () => new Date(),
  }
}

type Outcome = 'done' | 'skipped' | 'retried' | 'dead'
export type WorkerSummary = { claimed: number; done: number; skipped: number; retried: number; dead: number }

function logT(transition: string, job: AutomationJob, extra: Record<string, unknown> = {}): void {
  console.log(LOG, { transition, jobId: job.id, automationId: job.automationId, agencyId: job.agencyId, leadId: job.leadId, ...extra })
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
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed', mode, trigger: job.trigger, origin: job.origin,
      })
      await deps.deadJob(job.id, 'ambiguous_after_crash')
      logT('dead', job, { reason: 'ambiguous_after_crash', class: 'ambiguous', userVisible: true })
      return 'dead'
    }
    if (!(await deps.hasEffect(job.automationId, job.leadId))) {
      await deps.appendActivity({
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'would_send', mode: 'log', trigger: job.trigger, origin: job.origin,
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

  const now = deps.now()
  const since = new Date(startOfBusinessDayMs(now.getTime()))
  const email = lead.exists ? lead.email : null
  const facts: SendFacts = {
    event: { trigger: job.trigger, origin: job.origin, agencyId: job.agencyId, leadId: job.leadId, occurredAt: new Date(job.createdAt) },
    expectedStatus: def.targetStatus,
    lead: {
      exists: lead.exists,
      email,
      currentStatus: lead.exists ? lead.currentStatus : null,
      emailUndeliverable: lead.exists && email ? await deps.isBlocked(job.agencyId, email) : false,
    },
    suppressed: await deps.isSuppressed(job.agencyId, job.leadId),
    alreadySent: claimState === 'confirmed',
    sentToLeadToday: await deps.countLeadToday(job.agencyId, job.leadId, since),
    sentByAgencyToday: await deps.countAgencyToday(job.agencyId, since),
    quietHours: null, // no per-agency window config in V1 (folded 'מתקדם' arrives with Phase 6)
    now,
  }

  const decision = decideSend(facts)
  if ('reason' in decision) {
    const reason = decision.reason
    await deps.appendActivity({
      agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
      leadName: lead.exists ? lead.displayName : null,
      kind: 'skipped', mode, trigger: job.trigger, origin: job.origin, skipReason: reason,
    })
    await deps.skipJob(job.id, reason)
    logT('skipped', job, { reason, class: 'law', userVisible: true })
    return 'skipped'
  }

  // Identity is resolved BEFORE the claim (ADR-013): an unresolvable identity
  // is a configuration fault, and burning the lead's once-ever allowance on it
  // would mean the lead never gets the email even after the config is fixed.
  const businessName = await deps.agencyName(job.agencyId)
  const sender = resolveSenderIdentity(
    { agencyName: businessName, replyTo: await deps.replyTo(job.agencyId) },
    getAutomationsFrom(),
  )
  if (sender.problem) {
    // Log mode still renders a truthful preview; only a real send is blocked.
    if (mode === 'live') {
      await deps.appendActivity({
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed', mode, trigger: job.trigger, origin: job.origin,
      })
      // Definitive, never retried — a retry storm cannot fix a misconfiguration.
      await deps.deadJob(job.id, `identity_unavailable:${sender.problem}`)
      logT('dead', job, { reason: sender.problem, class: 'identity', userVisible: true })
      return 'dead'
    }
    logT('identity_incomplete', job, { reason: sender.problem, class: 'identity', blocking: false })
  }

  if (!(await deps.claimOnce({ agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId, mode }))) {
    await deps.appendActivity({
      agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
      leadName: lead.exists ? lead.displayName : null,
      kind: 'skipped', mode, trigger: job.trigger, origin: job.origin, skipReason: 'already_sent',
    })
    await deps.skipJob(job.id, 'already_sent')
    logT('skipped', job, { reason: 'already_sent', class: 'raced_claim', userVisible: true })
    return 'skipped'
  }

  // Claim held from here: any failure below releases it (retry re-claims).
  try {
    const leadExists = lead.exists ? lead : null
    const rendered = await renderAutomationEmail({
      subject: def.content.subject,
      body: def.content.body,
      vars: {
        // The identity's display name and the rendered business name are the
        // same resolved value — the email cannot say one thing and sign another.
        leadFirstName: leadExists?.firstName ?? null,
        businessName: sender.identity?.displayName ?? businessName,
        repName: await deps.repName(leadExists?.handlerId ?? null),
      },
      unsubscribeUrl: leadUnsubscribeUrl(baseUrl, job.agencyId, job.leadId),
    })

    if (mode === 'live' && sender.identity) {
      const res = await deps.send({
        from: sender.identity.from,
        replyTo: sender.identity.replyTo,
        to: email as string,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      if ('error' in res) throw new Error(`transport: ${res.error}`)
      await deps.appendActivity({
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: leadExists?.displayName ?? null,
        kind: 'sent', mode, trigger: job.trigger, origin: job.origin,
        subject: rendered.subject, deliveryState: 'sent', providerMessageId: res.id,
        contentSchemaVersion: def.content.schemaVersion,
      })
      logT('sent', job, { reason: 'transport_accepted', providerMessageId: res.id })
    } else {
      await deps.appendActivity({
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: leadExists?.displayName ?? null,
        kind: 'would_send', mode: 'log', trigger: job.trigger, origin: job.origin,
        subject: rendered.subject, contentSchemaVersion: def.content.schemaVersion,
      })
      logT('would_send', job, { reason: 'log_mode', subject: rendered.subject })
    }

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
        agencyId: job.agencyId, automationId: job.automationId, leadId: job.leadId,
        leadName: lead.exists ? lead.displayName : null,
        kind: 'failed', mode, trigger: job.trigger, origin: job.origin,
      })
      logT('dead', job, { reason: String(err), class: 'exhausted', attempts: job.attempts, userVisible: true, copy: FAILURE_COPY.terminal })
      return 'dead'
    }
    logT('retried', job, { reason: String(err), class: 'transient', attempts: job.attempts })
    return 'retried'
  }
}

export async function runAutomationWorker(opts?: { limit?: number; workerId?: string; deps?: WorkerDeps }): Promise<WorkerSummary> {
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
