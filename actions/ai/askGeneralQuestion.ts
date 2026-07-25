'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  getLeadsByName,
  getNamedLeadById,
  type NamedLead,
  type Scope,
} from '@/db/briefing'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { askLeadQuestion } from '@/actions/ai/leadAskQuestion'
import { extractLeadCandidate, isLeadFollowup } from '@/lib/copilot/general/subjectResolution'
import { classifyFallback, detectKnownGap, type FallbackResult } from '@/lib/copilot/general/fallback'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import { composeOverviewSentence } from '@/lib/copilot/general/overviewSentence'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'
import { GENERAL_HIGH_CONFIDENCE } from '@/lib/copilot/general/constants'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import { isCopilotModeId, type CopilotModeId } from '@/lib/ai/copilotModes'
import { tryReasonedAnswer, shouldReason, type ReasonedAnswer } from '@/lib/copilot/general/reasonedAnswer'
import { isReasonedGeneralEnabledForUser, isSynthesisEnabledForUser } from '@/lib/copilot/featureFlag'
import { classifyConversationIntent } from '@/lib/copilot/general/conversationIntent'
import { gatherTriageFacts } from '@/lib/copilot/general/facts/gatherFacts'
import { classifyStates } from '@/lib/copilot/general/businessState'
import { synthesize } from '@/lib/copilot/general/synthesis/synthesize'
import { traceSynthesis } from '@/lib/copilot/general/synthesis/synthesisTrace'
import type { ConversationState } from '@/lib/copilot/general/conversationState'
import { Roles } from '@/types/roles'

export type LeadCard = {
  id: number
  name: string
  status: string | null
  leadSource: string | null
  daysSinceLastInteraction: number | null
  daysInCurrentStatus: number | null
  overdueTaskCount: number
  nextFollowUpAt: string | null
  recentTasks: { title: string; status: string | null }[]
}

export type GeneralAnswer =
  | ({ kind: 'fallback' } & FallbackResult)
  | { kind: 'guide'; answer: string; route?: string }
  | { kind: 'data'; intent: string; payload: unknown }
  | { kind: 'lead'; lead: LeadCard }
  | { kind: 'leadPick'; name: string; candidates: { leadId: number; label: string; status: string | null }[] }
  | { kind: 'leadAnswer'; text: string; leadName: string }
  | ReasonedAnswer

type ActingUser = { agencyId: number; id: number; role: Roles }

async function safeTrack(user: ActingUser, event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  try {
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // never impact the request
  }
}

export async function askGeneralQuestion(
  text: string,
  modeRaw?: unknown,
  activeLeadIdRaw?: unknown,
  conversationState?: ConversationState | null,
): Promise<GeneralAnswer> {
  const user = await requireProductAccess()
  const mode = isCopilotModeId(modeRaw) ? modeRaw : undefined
  const n = Number(activeLeadIdRaw)
  const activeLeadId = Number.isFinite(n) && n > 0 ? n : undefined
  try {
    const answer = await resolveAnswer(text, user, mode, activeLeadId, conversationState ?? null)
    const subjectActive = activeLeadId != null
    await safeTrack(user, 'general_mode.question_asked', { qlen: text.length, subjectActive })

    await safeTrack(user, 'general_mode.answer_rendered', {
      path: resolvedPath(answer),
      subjectActive,
      text: text.slice(0, 200),
      intent: answer.kind === 'data' ? answer.intent : undefined,
      gap: answer.kind === 'fallback' && answer.mode === 'redirect' ? answer.gap : undefined,
    })
    return answer
  } catch {
    await safeTrack(user, 'general_mode.error', { stage: 'qa' })
    return { kind: 'fallback', mode: 'redirect', gap: null }
  }
}

export async function getLeadCardById(leadIdRaw: number | string): Promise<GeneralAnswer> {
  const user = await requireProductAccess()
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { kind: 'guide', answer: 'לא הצלחתי לטעון את הליד.' }
  const { gotPermIds } = await getPerms(user)
  const match = await getNamedLeadById({ user: { role: user.role }, gotPermIds }, leadId)
  if (!match) return { kind: 'guide', answer: 'לא הצלחתי לטעון את הליד.' }
  await safeTrack(user, 'general_mode.answer_rendered', { path: 'lead_resolution', via: 'pick' })
  return buildLeadCard(match)
}

function resolvedPath(
  a: GeneralAnswer,
): 'business_intent' | 'reasoned' | 'lead_resolution' | 'lead_followup' | 'guide' | 'ack' | 'clarify' | 'redirect' {
  switch (a.kind) {
    case 'reasoned':
      return 'reasoned'
    case 'data':
      return 'business_intent'
    case 'lead':
    case 'leadPick':
      return 'lead_resolution'
    case 'leadAnswer':
      return 'lead_followup'
    case 'guide':
      return 'guide'
    case 'fallback':
      return a.mode
  }
}

function extractLeadReplyText(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.answer === 'string' && d.answer.trim()) return d.answer.trim()
    if (typeof d.reply === 'string' && d.reply.trim()) return d.reply.trim()
    if (typeof d.intro === 'string' && d.intro.trim()) return d.intro.trim()
  }
  return null
}

async function answerAsLeadFollowup(
  leadId: number,
  text: string,
  user: ActingUser,
  mode?: CopilotModeId,
): Promise<GeneralAnswer | null> {
  const { gotPermIds } = await getPerms(user)
  const inScope = await getNamedLeadById({ user: { role: user.role }, gotPermIds }, leadId)
  if (!inScope) return null // out of scope → ignore the subject
  const res = await askLeadQuestion(leadId, text, [], [], mode)
  if (!res.ok) return null
  const replyText = extractLeadReplyText(res.data)
  return replyText ? { kind: 'leadAnswer', text: replyText, leadName: inScope.name } : null
}

async function buildLeadCard(match: NamedLead): Promise<GeneralAnswer> {
  const snap = await getLeadIntelligenceInputs(match.id).catch(() => null)
  const i = snap?.inputs
  return {
    kind: 'lead',
    lead: {
      id: match.id,
      name: match.name,
      status: i?.status ?? null,
      leadSource: i?.leadSource ?? null,
      daysSinceLastInteraction: i?.daysSinceLastInteraction ?? null,
      daysInCurrentStatus: i?.daysInCurrentStatus ?? null,
      overdueTaskCount: i?.overdueTaskCount ?? 0,
      nextFollowUpAt: match.nextFollowUpAt,
      recentTasks: (i?.recentTasks ?? []).slice(0, 3).map((t) => ({ title: t.title, status: t.status })),
    },
  }
}

async function resolveLeadSubject(text: string, user: ActingUser): Promise<GeneralAnswer | null> {
  const candidate = extractLeadCandidate(text)
  if (!candidate) return null // weak signal → Business
  const { gotPermIds } = await getPerms(user)
  const matches = await getLeadsByName({ user: { role: user.role }, gotPermIds }, candidate)
  if (matches.length === 1) return buildLeadCard(matches[0])
  if (matches.length > 1) {
    return {
      kind: 'leadPick',
      name: candidate,
      candidates: matches.slice(0, 6).map((m) => ({ leadId: m.id, label: m.name, status: m.status })),
    }
  }
  return { kind: 'guide', answer: `לא מצאתי ליד בשם "${candidate}".` } // honest miss
}

async function resolveAnswer(
  text: string,
  user: ActingUser,
  mode?: CopilotModeId,
  activeLeadId?: number,
  conversationState?: ConversationState | null,
): Promise<GeneralAnswer> {
  // TEMP DIAGNOSTIC (C9 follow-up reachability) — remove after capture
  console.log(
    '[c9-trace:server] received conversationState =',
    conversationState,
    '| intent =',
    classifyConversationIntent(text),
    '| entersFollowUpBranch =',
    !!(conversationState && classifyConversationIntent(text) === 'follow_up'),
    '| synthesisFlag =',
    isSynthesisEnabledForUser(user),
  )
  if (conversationState && classifyConversationIntent(text) === 'follow_up') {
    if (isSynthesisEnabledForUser(user)) {
      const { gotPermIds } = await getPerms(user)
      const scope: Scope = { user: { role: user.role }, gotPermIds }
      const states = classifyStates(await gatherTriageFacts(scope))
      const startedAt = Date.now()
      const observation = synthesize(states)
      traceSynthesis({ states, startedAt, now: Date.now() }) // passive observability; never affects the answer
      if (observation) return { kind: 'guide', answer: observation.statement }
    }
    return {
      kind: 'guide',
      answer: 'אלה הדברים שהכי חשובים כרגע — השאר יכול לחכות. אם יש משהו ספציפי שתרצה להעמיק בו, תגיד.',
    }
  }

  const leadSubject = await resolveLeadSubject(text, user)
  if (leadSubject) return leadSubject

  const knownGap = detectKnownGap(text)
  if (knownGap) return { kind: 'fallback', mode: 'redirect', gap: knownGap }

  if (isReasonedGeneralEnabledForUser(user) && !(activeLeadId && isLeadFollowup(text)) && shouldReason(text)) {
    const { gotPermIds } = await getPerms(user)
    const scope: Scope = { user: { role: user.role }, gotPermIds }
    const reasoned = await tryReasonedAnswer({ text, scope, agencyId: user.agencyId, userId: user.id, mode })
    if (reasoned) return reasoned
  }

  const c = await classifyGeneralIntent(text, user.agencyId, mode)

  if (c.intent === 'unknown' || c.confidence < GENERAL_HIGH_CONFIDENCE) {
    if (activeLeadId && isLeadFollowup(text)) {
      const leadFollowup = await answerAsLeadFollowup(activeLeadId, text, user, mode)
      if (leadFollowup) return leadFollowup
    }
    return { kind: 'fallback', ...classifyFallback(text) }
  }

  if (c.intent.startsWith('guide.')) {
    const g = GUIDE_ENTRIES.find((e) => e.id === c.intent)
    if (!g) return { kind: 'fallback', mode: 'redirect', gap: null }
    return { kind: 'guide', answer: g.answer, route: g.route }
  }

  const { gotPermIds } = await getPerms(user)
  const scope: Scope = { user: { role: user.role }, gotPermIds }
  const payload = await runIntent(c.intent, user, scope)
  return { kind: 'data', intent: c.intent, payload }
}

async function runIntent(intent: string, user: ActingUser, scope: Scope) {
  switch (intent) {
    case 'followups.dueToday':
      return getFollowUpsDueToday(scope)
    case 'leads.notContactedRecently':
      return getLeadsNotContactedRecently(scope)
    case 'tasks.overdue':
      return getOverdueTaskSummary(scope)
    case 'meetings.today':
      return { meetings: await getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }) }
    case 'leads.newThisWeek':
      return getNewLeadsThisWeek(scope)
    case 'inbox.unread':
      return getUnreadInboxSummary(scope)
    case 'crm.attention': {
      const [dueToday, overdue, stale] = await Promise.all([
        getFollowUpsDueToday(scope),
        getOverdueTaskSummary(scope),
        getLeadsNotContactedRecently(scope),
      ])
      return { overdue, dueToday, stale }
    }
    case 'system.overview': {
      const [overdue, meetings, inbox, stale, newLeads] = await Promise.all([
        getOverdueTaskSummary(scope),
        getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
        getUnreadInboxSummary(scope),
        getLeadsNotContactedRecently(scope),
        getNewLeadsThisWeek(scope),
      ])
      return {
        summary: composeOverviewSentence({
          overdueTasks: overdue.total,
          meetingsToday: meetings.length,
          waitingConversations: inbox.conversations,
          staleLeads: stale.total,
          newLeads: newLeads.total,
        }),
      }
    }
    default:
      return {}
  }
}
