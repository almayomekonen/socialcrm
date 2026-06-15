'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { classifyGeneralIntent } from '@/lib/copilot/general/classifyGeneralIntent'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'
import { GENERAL_HIGH_CONFIDENCE } from '@/lib/copilot/general/constants'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import { Roles } from '@/types/roles'

export type GeneralAnswer =
  | { kind: 'menu'; reason: 'unknown' | 'low-confidence' }
  | { kind: 'guide'; answer: string; route?: string }
  | { kind: 'data'; intent: string; payload: unknown }

type ActingUser = { agencyId: number; id: number; role: Roles }

/**
 * Analytics is fully isolated from functionality: the user-facing answer is
 * computed FIRST, then events are emitted through `safeTrack`, which can never
 * throw or reject into this flow. A broken analytics layer changes nothing the
 * caller sees. (Proven in __tests__/ai/ask-general-question.test.ts.)
 */
async function safeTrack(user: ActingUser, event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  try {
    await track({ agencyId: user.agencyId, userId: user.id, event, props })
  } catch {
    // never impact the request
  }
}

export async function askGeneralQuestion(text: string): Promise<GeneralAnswer> {
  const user = await requireAgencyUser()
  try {
    const answer = await resolveAnswer(text, user)
    await safeTrack(user, 'general_mode.question_asked', { len: text.length })
    await safeTrack(user, 'general_mode.answer_rendered', answerProps(answer))
    return answer
  } catch {
    // Unexpected failure → graceful menu, never an error thrown at the user.
    await safeTrack(user, 'general_mode.error', { stage: 'qa' })
    return { kind: 'menu', reason: 'unknown' }
  }
}

function answerProps(a: GeneralAnswer): Record<string, unknown> {
  if (a.kind === 'data') return { kind: 'data', intent: a.intent }
  if (a.kind === 'guide') return { kind: 'guide' }
  return { kind: 'menu', reason: a.reason }
}

async function resolveAnswer(text: string, user: ActingUser): Promise<GeneralAnswer> {
  const c = await classifyGeneralIntent(text, user.agencyId)

  if (c.intent === 'unknown' || c.confidence < GENERAL_HIGH_CONFIDENCE) {
    return { kind: 'menu', reason: c.intent === 'unknown' ? 'unknown' : 'low-confidence' }
  }

  if (c.intent.startsWith('guide.')) {
    const g = GUIDE_ENTRIES.find((e) => e.id === c.intent)
    if (!g) return { kind: 'menu', reason: 'unknown' }
    return { kind: 'guide', answer: g.answer, route: g.route }
  }

  const { gotPermIds } = await getPerms(user)
  const scope: Scope = { user: { role: user.role }, gotPermIds }
  const payload = await runIntent(c.intent, user, scope)
  return { kind: 'data', intent: c.intent, payload }
}

/** Deterministic, permission-scoped data handlers. No model call in this path. */
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
      // Deterministic prioritization: overdue > due-today > stale. No invented facts.
      return { overdue, dueToday, stale }
    }
    default:
      return {}
  }
}
