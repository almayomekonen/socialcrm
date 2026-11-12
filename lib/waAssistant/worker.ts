import 'server-only'
import { withAiOperation } from '@/lib/ai/usage/context'
import { recordAgentInvestigation } from '@/db/agentInvestigation'
import {
  claimWaAssistantJobs,
  finishWaAssistantJob,
  markWaAssistantReplySending,
  purgeWaAssistantText,
  reapStaleWaAssistantJobs,
  recentWaAssistantTurns,
  type WaAssistantFinish,
  type WaAssistantJob,
} from '@/db/waAssistantJobs'
import { runAgentInvestigation } from '@/lib/agent/run'
import { track } from '@/lib/analytics/track'
import { WA_ASSISTANT_LIMITS } from '@/lib/flags/waAssistantFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText, sendPlatformTypingIndicator, type ReplyButton, type ReplyDocument } from '@/lib/whatsapp/platform/sendText'
import { hasLiveWaApproval } from '@/db/waAssistantApprovals'
import { resolveAssistantScope } from './identity'
import { COPY, NO_ACTIONS_NOTE, failureReply, refusalReply, replyForAnswer } from './render'
import type { ProposeDeps } from './meetings/propose'
import { type DecideDeps } from './meetings/decide'
import { decideCard } from './decideCard'
import type { TaskProposeDeps } from './tasks/propose'
import { startsCleanRequest } from './request'
import { waAgentRules } from './agentRules'
import type { LeadUpdateProposeDeps } from './leadUpdates/propose'
import type { LeadUpdateDecideDeps } from './leadUpdates/decide'
import type { TaskDecideDeps } from './tasks/decide'
import type { QuoteProposeDeps } from './quotes/propose'
import type { QuoteDecideDeps } from './quotes/decide'
import { agentClarifyStopReason, assistantCapabilities, routeProposal } from './route'
import { answerSchemaFor } from '@/lib/agent/smartbeeAnswerSchema'
import type { DocumentProposeDeps } from './smartbee/propose'
import type { DocumentDecideDeps } from './smartbee/decide'
import { handleSmartbeeResolutionMessage } from './smartbee/resolve'
import { supersedeChangedDocumentCard } from './smartbee/staleCard'
import { MEETING_COPY } from './meetings/copy'
import { TASK_COPY } from './tasks/copy'
import type { MeetingReply } from './meetings/types'
import { handleReminderMessage } from './reminders/route'
import { admitAgentRequest } from '@/db/credits/agentRequests'
import { creditLimitReply } from './creditLimitReply'
import { decideUsageLimits } from './limits'
import type { ReminderDeps } from './reminders/reply'
import { handleQuoteReviewMessage } from './quotes/review'
import { chosenLeadRule, requestLead } from './leadChoice'

/**
 * The WhatsApp assistant worker: one queued owner message -> at most one reply.
 * Run right after the webhook (`after()`) and every minute by
 * app/api/cron/wa-assistant as the backstop.
 *
 * Per job, in this order, and nothing is read before step 2 passes:
 *   1. the 23-hour reply window (Meta's 24h service window, with a margin);
 *   2. WHO: recipient, user, agency, product access and the Agent rollout,
 *      re-checked from the database (./identity.ts);
 *   3. limits: per sender per hour, per agency per day, durable daily spend;
 *   4. the existing Agent (lib/agent/run.ts) with the read tools only, no web
 *      research, a shorter clock, and the previous turns as context;
 *   5. one reply, with `sending` committed first (`unknown` is never resent).
 *
 * WRITES: `create_meeting` (WA_ASSISTANT_MEETINGS_AGENCY_IDS), `create_task` /
 * `create_follow_up` (WA_ASSISTANT_TASKS_AGENCY_IDS, ./tasks/),
 * `update_lead_status` (WA_ASSISTANT_STATUS_AGENCY_IDS), `add_lead_note`
 * (WA_ASSISTANT_NOTES_AGENCY_IDS, both ./leadUpdates/) and `create_quote`
 * (WA_ASSISTANT_QUOTES_AGENCY_IDS, ./quotes/; to the customer only with
 * WA_ASSISTANT_QUOTES_SEND_* and a tap on the finished PDF's card), each only for
 * an agency on its own list, and never on the owner's words alone: the
 * proposal becomes a confirmation card (./meetings/propose.ts) and only a tap on
 * its button executes it through the existing Action Runtime
 * (./meetings/decide.ts). Every other proposal (and every proposal without that
 * flag) is NEVER handed to the Action Runtime; the reply says so.
 *
 * PERSONAL REMINDERS (WA_ASSISTANT_REMINDERS_AGENCY_IDS, ./reminders/): create,
 * list, cancel and reschedule the owner's own reminders, handled BEFORE the
 * Agent and without it; writes only through cards and the Action Runtime.
 *
 * The per-action proposal routing and the capability switches live in
 * ./route.ts (the extraction this file owed); this file is the job lifecycle
 * (window, identity, limits, the per-request credit admission, Agent run, one
 * reply). A card tap returns before that admission: no model runs for it.
 *
 * NOTE (architecture-rules §6): ~285 lines, a little over the 250 soft limit,
 * most of it this header. One concern, linear per job; the next write
 * capability adds its routing to ./route.ts, not here.
 */

export type WaAssistantDeps = {
  runAgent?: typeof runAgentInvestigation
  sendText?: typeof sendPlatformText
  typing?: typeof sendPlatformTypingIndicator
  now?: () => Date
  meetings?: { propose?: ProposeDeps; decide?: DecideDeps }
  tasks?: { propose?: TaskProposeDeps; decide?: TaskDecideDeps }
  leadUpdates?: { propose?: LeadUpdateProposeDeps; decide?: LeadUpdateDecideDeps }
  quotes?: { propose?: QuoteProposeDeps; decide?: QuoteDecideDeps }
  documents?: { propose?: DocumentProposeDeps; decide?: DocumentDecideDeps }
  reminders?: ReminderDeps
}

/** A typed "yes" while a card is open: pointed at the button, never treated as approval. */
const BARE_AFFIRMATION = /^(כן|אשר|לאשר|מאשר|מאשרת|אישור|יאללה|סגור|בטח|ok|okay|אוקי|אוקיי)[\s!.]*$/iu

export type WaAssistantTickSummary = { disabled: boolean; reaped: number; purged: number; claimed: number; outcomes: Record<string, number> }

export async function runWaAssistantWorker(opts: { limit?: number } = {}, deps: WaAssistantDeps = {}): Promise<WaAssistantTickSummary> {
  const now = deps.now ?? (() => new Date())
  const summary: WaAssistantTickSummary = { disabled: false, reaped: 0, purged: 0, claimed: 0, outcomes: {} }
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  if (!phoneNumberId || !accessToken) {
    summary.disabled = true
    return summary
  }
  summary.reaped = await reapStaleWaAssistantJobs(now())
  summary.purged = await purgeWaAssistantText(now())
  const jobs = await claimWaAssistantJobs(opts.limit ?? WA_ASSISTANT_LIMITS.batch)
  summary.claimed = jobs.length
  for (const job of jobs) {
    let status = 'failed'
    try {
      // Usage ledger: the Agent's provider requests for this owner message are recorded under it.
      status = await withAiOperation({ kind: 'wa_assistant_job', id: String(job.id), agencyId: job.agencyId, userId: job.userId }, () =>
        processJob(job, { phoneNumberId, accessToken }, deps, now),
      )
    } catch (err) {
      console.error('[WaAssistant][job] failed', { jobId: job.id, name: (err as Error)?.name ?? null })
      await finishWaAssistantJob(job.id, { status: 'failed', stopReason: 'exception' }).catch(() => undefined)
    }
    summary.outcomes[status] = (summary.outcomes[status] ?? 0) + 1
  }
  return summary
}

type Platform = { phoneNumberId: string; accessToken: string }

/** Commercial limits a founder's job bypassed, for the audit event (finish). */
const waivedLimits = new WeakMap<WaAssistantJob, string[]>()

async function processJob(job: WaAssistantJob, platform: Platform, deps: WaAssistantDeps, now: () => Date): Promise<string> {
  const startedAt = now()
  const elapsed = () => now().getTime() - startedAt.getTime()

  const expired = startedAt.getTime() - job.messageTimestamp * 1000 > WA_ASSISTANT_LIMITS.replyWindowMs

  const who = await resolveAssistantScope(job, startedAt)
  // A correction after a SmartBee card ("לא, 2000") voids that card FIRST: even when this turn is too late
  // to answer, over a limit, a reminder, or asks a question instead of showing a new card. Never sends.
  if (who.ok && assistantCapabilities(job.agencyId).documentsOn) await supersedeChangedDocumentCard(job)

  if (expired) return finish(job, { status: 'expired', reply: { state: 'skipped' } })
  if (who.ok === false) {
    const text = refusalReply(who.reason)
    const reply = text && who.phoneE164 ? await reply1(job, platform, who.phoneE164, text, deps) : { state: 'skipped' as const }
    return finish(job, { status: 'refused', refusalReason: who.reason, reply, durationMs: elapsed() })
  }

  // Commercial limits, or for a verified founder the technical abuse guards instead (./limits.ts).
  const limits = await decideUsageLimits(job, startedAt)
  if (limits.waived.length) waivedLimits.set(job, limits.waived)
  if (limits.refusal) {
    const text = refusalReply(limits.refusal.reason)
    const reply = limits.refusal.firstOver && text ? await reply1(job, platform, who.phoneE164, text, deps) : { state: 'skipped' as const }
    return finish(job, { status: 'refused', refusalReason: limits.refusal.reason, reply, durationMs: elapsed() })
  }

  const caps = assistantCapabilities(job.agencyId)
  const { tasksOn, remindersOn, writesOn } = caps
  if (job.kind === 'decision') {
    const r =
      writesOn
        ? await decideCard({ job, scope: who.scope, nowMs: startedAt.getTime(), ...caps, deps: { meetings: deps.meetings?.decide, tasks: deps.tasks?.decide, leadUpdates: deps.leadUpdates?.decide, reminders: deps.reminders, quotes: deps.quotes?.decide, documents: deps.documents?.decide } })
        : { status: 'refused' as const, stopReason: 'meetings_disabled', text: COPY.notAvailable, headline: null }
    return finishMeeting(job, platform, who.phoneE164, r, deps, { durationMs: elapsed() })
  }
  if (writesOn && job.kind === 'text' && BARE_AFFIRMATION.test(job.question?.trim() ?? '') && (await hasLiveWaApproval(job.recipientId, startedAt))) {
    return finishMeeting(job, platform, who.phoneE164, { status: 'answered', stopReason: 'meeting_use_buttons', text: tasksOn ? TASK_COPY.useButtons : MEETING_COPY.useButtons, headline: null }, deps, { durationMs: elapsed() })
  }

  if (job.kind === 'unsupported' || !job.question?.trim()) {
    const text = job.kind === 'unsupported' ? COPY.unsupported : COPY.emptyQuestion
    return finish(job, { status: 'answered', stopReason: job.kind, reply: await reply1(job, platform, who.phoneE164, text, deps), durationMs: elapsed() })
  }

  // Personal reminders (WA_ASSISTANT_REMINDERS_AGENCY_IDS only): deterministic, before the Agent, so with the switch on "תזכיר לי" never becomes a task.
  const reminder = remindersOn ? await handleReminderMessage({ job, scope: who.scope, nowMs: startedAt.getTime(), deps: deps.reminders }) : null
  if (reminder) return finishMeeting(job, platform, who.phoneE164, reminder, deps, { durationMs: elapsed() })
  // A stalled SmartBee document settled by its owner's fixed words (SMARTBEE_AGENCY_IDS only): deterministic, no model.
  const resolution = caps.documentsOn ? await handleSmartbeeResolutionMessage({ job, scope: who.scope, nowMs: startedAt.getTime() }) : null
  if (resolution) return finishMeeting(job, platform, who.phoneE164, resolution, deps, { durationMs: elapsed() })

  // "תראה לי שוב את ההצעה": the send card again, without a model and without a credit.
  const review = caps.quotesSendOn ? await handleQuoteReviewMessage({ job, scope: who.scope, nowMs: startedAt.getTime() }) : null
  if (review) return finishMeeting(job, platform, who.phoneE164, review, deps, { durationMs: elapsed() })

  // The free allowance / purchased credits: decided once per job, before any model runs (db/credits/agentRequests.ts).
  const access = await admitAgentRequest({ agencyId: job.agencyId, userId: job.userId, source: 'whatsapp', operation: { kind: 'wa_assistant_job', id: String(job.id) }, nowMs: startedAt.getTime() })
  if ('reason' in access) {
    const text = access.reason === 'unavailable' ? failureReply('error') : await creditLimitReply(job.agencyId, access.notice, who.scope.role)
    return finish(job, { status: 'answered', stopReason: access.reason, reply: text ? await reply1(job, platform, who.phoneE164, text, deps) : { state: 'skipped' }, durationMs: elapsed() })
  }

  await (deps.typing ?? sendPlatformTypingIndicator)({ ...platform, inboundWamid: job.wamid, jobId: job.id })

  // A lead the owner already chose in this request: decided here, never by the model.
  const chosen = writesOn ? await requestLead(job, who.scope) : null
  const history = await recentWaAssistantTurns(job.recipientId, job.id, startedAt, { withoutClarifications: writesOn && (await startsCleanRequest(job)) })
  const result = await (deps.runAgent ?? runAgentInvestigation)({
    question: job.question.trim().slice(0, WA_ASSISTANT_LIMITS.maxQuestionChars),
    history,
    scope: who.scope,
    maxSteps: WA_ASSISTANT_LIMITS.maxSteps,
    deadlineMs: WA_ASSISTANT_LIMITS.deadlineMs,
    disableResearch: true,
    surfaceRules: chosen ? `${waAgentRules(caps)}\n${chosenLeadRule(chosen.leadId)}` : waAgentRules(caps),
    // SmartBee documents (one agency, SMARTBEE_AGENCY_IDS): only its turns are even offered the action.
    answerSchema: answerSchemaFor(caps.documentsOn),
    verifiedLeadIds: chosen ? [chosen.leadId] : undefined,
    // Accounted durably per job (costUsd) instead of the in-memory interactive counter.
    skipInteractiveSpend: true,
    onPersist: async (record) => {
      try {
        await recordAgentInvestigation(record)
      } catch (e) {
        console.error('[WaAssistant][persist] failed', { jobId: job.id, name: (e as Error)?.name ?? null })
      }
    },
  })

  if (result.ok !== true) {
    return finish(job, {
      status: 'failed',
      stopReason: result.reason,
      costUsd: result.costUsd ?? 0,
      reply: await reply1(job, platform, who.phoneE164, failureReply(result.reason), deps),
      durationMs: elapsed(),
    })
  }

  const routed = await routeProposal({
    job,
    scope: who.scope,
    result,
    caps,
    nowMs: startedAt.getTime(),
    deps: { meetings: deps.meetings?.propose, tasks: deps.tasks?.propose, leadUpdates: deps.leadUpdates?.propose, quotes: deps.quotes?.propose, documents: deps.documents?.propose },
  })
  if (routed) return finishMeeting(job, platform, who.phoneE164, routed, deps, { durationMs: elapsed(), costUsd: result.costUsd })

  const note = result.answer.proposedAction || result.answer.proposedBatch ? NO_ACTIONS_NOTE : null
  const reply = replyForAnswer(result.answer, { note })
  const continues = await agentClarifyStopReason(job, result, caps, note != null)
  return finish(job, {
    status: 'answered',
    stopReason: continues ?? result.stopReason,
    answerHeadline: reply.headline,
    costUsd: result.costUsd,
    reply: await reply1(job, platform, who.phoneE164, reply.text, deps),
    durationMs: elapsed(),
  })
}

/** A meeting step's result: its one reply (if any) and the job's close. */
async function finishMeeting(job: WaAssistantJob, platform: Platform, toE164: string, r: MeetingReply, deps: WaAssistantDeps, extra: { durationMs: number; costUsd?: number }): Promise<string> {
  const reply = r.text ? await reply1(job, platform, toE164, r.text, deps, r.buttons, r.document) : { state: 'skipped' as const }
  return finish(job, { status: r.status, stopReason: r.stopReason, answerHeadline: r.headline, costUsd: extra.costUsd ?? 0, reply, durationMs: extra.durationMs })
}

/** The one reply for this job. `sending` is committed first; a second attempt is impossible. */
async function reply1(job: WaAssistantJob, platform: Platform, toE164: string, body: string, deps: WaAssistantDeps, buttons?: ReplyButton[], document?: ReplyDocument | null): Promise<NonNullable<WaAssistantFinish['reply']>> {
  if (!(await markWaAssistantReplySending(job.id))) return { state: 'skipped' }
  const outcome = await (deps.sendText ?? sendPlatformText)({ ...platform, toE164, body, buttons, document, replyToWamid: job.wamid, jobId: job.id })
  if (outcome.kind === 'sent') return { state: 'sent', wamid: outcome.wamid }
  if (outcome.kind === 'unknown') return { state: 'unknown', errorCode: outcome.reason }
  return { state: 'failed', errorCode: outcome.code ?? outcome.scope }
}

async function finish(job: WaAssistantJob, f: WaAssistantFinish): Promise<string> {
  await finishWaAssistantJob(job.id, f)
  // Ids, outcomes, timing and cost only: never the question, the answer or a number.
  await track({
    agencyId: job.agencyId,
    userId: job.userId,
    event: 'wa_assistant_turn',
    props: {
      jobId: job.id,
      status: f.status,
      refusalReason: f.refusalReason ?? null,
      stopReason: f.stopReason ?? null,
      replyState: f.reply?.state ?? null,
      durationMs: f.durationMs ?? null,
      costUsd: f.costUsd ?? 0,
      limitWaived: waivedLimits.get(job) ?? null,
    },
  })
  return f.status
}
