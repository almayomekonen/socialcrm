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
  waAssistantUsage,
  type WaAssistantFinish,
  type WaAssistantJob,
} from '@/db/waAssistantJobs'
import { runAgentInvestigation } from '@/lib/agent/run'
import { track } from '@/lib/analytics/track'
import { WA_ASSISTANT_LIMITS, isWaAssistantMeetingsAgency, isWaAssistantTasksAgency, waAssistantDailyUsdCap } from '@/lib/flags/waAssistantFlags'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText, sendPlatformTypingIndicator, type ReplyButton } from '@/lib/whatsapp/platform/sendText'
import { hasLiveWaApproval } from '@/db/waAssistantApprovals'
import { resolveAssistantScope } from './identity'
import { COPY, NO_ACTIONS_NOTE, failureReply, refusalReply, replyForAnswer } from './render'
import { proposeMeeting, type ProposeDeps } from './meetings/propose'
import { type DecideDeps } from './meetings/decide'
import { decideCard } from './decideCard'
import { proposeTaskOrFollowUp, type TaskProposeDeps } from './tasks/propose'
import { isRequestConversation, startsCleanRequest } from './request'
import { WA_AGENT_RULES } from './agentRules'
import { isClarifyingAnswer } from './tasks/draft'
import type { TaskDecideDeps } from './tasks/decide'
import { MEETING_COPY } from './meetings/copy'
import { TASK_COPY } from './tasks/copy'
import type { MeetingReply } from './meetings/types'

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
 * WRITES: `create_meeting` (WA_ASSISTANT_MEETINGS_AGENCY_IDS) and `create_task` /
 * `create_follow_up` (WA_ASSISTANT_TASKS_AGENCY_IDS, ./tasks/), each only for
 * an agency on its own list, and never on the owner's words alone: the
 * proposal becomes a confirmation card (./meetings/propose.ts) and only a tap on
 * its button executes it through the existing Action Runtime
 * (./meetings/decide.ts). Every other proposal (and every proposal without that
 * flag) is NEVER handed to the Action Runtime; the reply says so.
 */

export type WaAssistantDeps = {
  runAgent?: typeof runAgentInvestigation
  sendText?: typeof sendPlatformText
  typing?: typeof sendPlatformTypingIndicator
  now?: () => Date
  meetings?: { propose?: ProposeDeps; decide?: DecideDeps }
  tasks?: { propose?: TaskProposeDeps; decide?: TaskDecideDeps }
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

async function processJob(job: WaAssistantJob, platform: Platform, deps: WaAssistantDeps, now: () => Date): Promise<string> {
  const startedAt = now()
  const elapsed = () => now().getTime() - startedAt.getTime()

  if (startedAt.getTime() - job.messageTimestamp * 1000 > WA_ASSISTANT_LIMITS.replyWindowMs) {
    return finish(job, { status: 'expired', reply: { state: 'skipped' } })
  }

  const who = await resolveAssistantScope(job, startedAt)
  if (who.ok === false) {
    const text = refusalReply(who.reason)
    const reply = text && who.phoneE164 ? await reply1(job, platform, who.phoneE164, text, deps) : { state: 'skipped' as const }
    return finish(job, { status: 'refused', refusalReason: who.reason, reply, durationMs: elapsed() })
  }

  const usage = await waAssistantUsage(job, startedAt)
  const limitReason =
    usage.senderLastHour >= WA_ASSISTANT_LIMITS.perSenderPerHour ? 'sender_limit'
    : usage.agencyToday >= WA_ASSISTANT_LIMITS.perAgencyPerDay ? 'agency_limit'
    : usage.agencySpendTodayUsd >= waAssistantDailyUsdCap() ? 'spend_limit'
    : null
  if (limitReason) {
    // Answer only the FIRST message over a count limit, so a limit cannot itself become a flood of replies.
    const firstOver = limitReason === 'sender_limit' ? usage.senderLastHour === WA_ASSISTANT_LIMITS.perSenderPerHour : limitReason === 'agency_limit' ? usage.agencyToday === WA_ASSISTANT_LIMITS.perAgencyPerDay : true
    const text = refusalReply(limitReason)
    const reply = firstOver && text ? await reply1(job, platform, who.phoneE164, text, deps) : { state: 'skipped' as const }
    return finish(job, { status: 'refused', refusalReason: limitReason, reply, durationMs: elapsed() })
  }

  const meetingsOn = isWaAssistantMeetingsAgency(job.agencyId)
  const tasksOn = isWaAssistantTasksAgency(job.agencyId)
  if (job.kind === 'decision') {
    const r =
      meetingsOn || tasksOn
        ? await decideCard({ job, scope: who.scope, nowMs: startedAt.getTime(), meetingsOn, tasksOn, deps: { meetings: deps.meetings?.decide, tasks: deps.tasks?.decide } })
        : { status: 'refused' as const, stopReason: 'meetings_disabled', text: COPY.notAvailable, headline: null }
    return finishMeeting(job, platform, who.phoneE164, r, deps, { durationMs: elapsed() })
  }
  if ((meetingsOn || tasksOn) && job.kind === 'text' && BARE_AFFIRMATION.test(job.question?.trim() ?? '') && (await hasLiveWaApproval(job.recipientId, startedAt))) {
    return finishMeeting(job, platform, who.phoneE164, { status: 'answered', stopReason: 'meeting_use_buttons', text: tasksOn ? TASK_COPY.useButtons : MEETING_COPY.useButtons, headline: null }, deps, { durationMs: elapsed() })
  }

  if (job.kind === 'unsupported' || !job.question?.trim()) {
    const text = job.kind === 'unsupported' ? COPY.unsupported : COPY.emptyQuestion
    return finish(job, { status: 'answered', stopReason: job.kind, reply: await reply1(job, platform, who.phoneE164, text, deps), durationMs: elapsed() })
  }

  await (deps.typing ?? sendPlatformTypingIndicator)({ ...platform, inboundWamid: job.wamid, jobId: job.id })

  const history = await recentWaAssistantTurns(job.recipientId, job.id, startedAt, { withoutClarifications: (meetingsOn || tasksOn) && (await startsCleanRequest(job)) })
  const result = await (deps.runAgent ?? runAgentInvestigation)({
    question: job.question.trim().slice(0, WA_ASSISTANT_LIMITS.maxQuestionChars),
    history,
    scope: who.scope,
    maxSteps: WA_ASSISTANT_LIMITS.maxSteps,
    deadlineMs: WA_ASSISTANT_LIMITS.deadlineMs,
    disableResearch: true,
    surfaceRules: WA_AGENT_RULES,
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

  const proposed = result.answer.proposedAction
  if (meetingsOn && proposed?.actionType === 'create_meeting' && !result.answer.proposedBatch) {
    const r = await proposeMeeting({ job, scope: who.scope, proposal: proposed, evidence: result.evidence, agentRunId: result.investigationId, question: job.question.trim(), nowMs: startedAt.getTime(), deps: deps.meetings?.propose })
    return finishMeeting(job, platform, who.phoneE164, r, deps, { durationMs: elapsed(), costUsd: result.costUsd })
  }
  if (tasksOn && (proposed?.actionType === 'create_task' || proposed?.actionType === 'create_follow_up') && !result.answer.proposedBatch) {
    const r = await proposeTaskOrFollowUp({ job, scope: who.scope, proposal: proposed, evidence: result.evidence, agentRunId: result.investigationId, question: job.question.trim(), nowMs: startedAt.getTime(), deps: deps.tasks?.propose })
    return finishMeeting(job, platform, who.phoneE164, r, deps, { durationMs: elapsed(), costUsd: result.costUsd })
  }

  const note = result.answer.proposedAction || result.answer.proposedBatch ? NO_ACTIONS_NOTE : null
  const reply = replyForAnswer(result.answer, { note })
  // The Agent's own question inside a request ("לאיזה ליד?") keeps that request open for the next message.
  const asking = !note && isClarifyingAnswer(result.answer)
  // "תקבע" opens both a meeting and a follow-up: it is a meeting only when the owner says so, or the open request already is one.
  const continues =
    asking && tasksOn && !/פגיש/u.test(job.question ?? '') && (await isRequestConversation('task', job))
      ? 'task_clarify_agent'
      : asking && meetingsOn && (await isRequestConversation('meeting', job))
        ? 'meeting_clarify_agent'
        : null
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
  const reply = r.text ? await reply1(job, platform, toE164, r.text, deps, r.buttons) : { state: 'skipped' as const }
  return finish(job, { status: r.status, stopReason: r.stopReason, answerHeadline: r.headline, costUsd: extra.costUsd ?? 0, reply, durationMs: extra.durationMs })
}

/** The one reply for this job. `sending` is committed first; a second attempt is impossible. */
async function reply1(job: WaAssistantJob, platform: Platform, toE164: string, body: string, deps: WaAssistantDeps, buttons?: ReplyButton[]): Promise<NonNullable<WaAssistantFinish['reply']>> {
  if (!(await markWaAssistantReplySending(job.id))) return { state: 'skipped' }
  const outcome = await (deps.sendText ?? sendPlatformText)({ ...platform, toE164, body, buttons, replyToWamid: job.wamid, jobId: job.id })
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
    },
  })
  return f.status
}
