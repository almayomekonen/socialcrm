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
import { composeOverviewSentence } from '@/lib/copilot/general/overviewSentence'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'
import { GENERAL_HIGH_CONFIDENCE } from '@/lib/copilot/general/constants'
import { detectsDriveIntent, maybePrefetchDrive, type DriveSearchOutcome } from '@/lib/copilot/driveIntent'
import type { DriveResults } from '@/lib/copilot/copilotResponse'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import { isCopilotModeId, type CopilotModeId } from '@/lib/ai/copilotModes'
import { Roles } from '@/types/roles'

export type GeneralAnswer =
  | { kind: 'menu'; reason: 'unknown' | 'low-confidence' }
  | { kind: 'guide'; answer: string; route?: string }
  | { kind: 'data'; intent: string; payload: unknown }
  | { kind: 'drive'; data: DriveResults }

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

export async function askGeneralQuestion(text: string, modeRaw?: unknown): Promise<GeneralAnswer> {
  const user = await requireAgencyUser()
  const mode = isCopilotModeId(modeRaw) ? modeRaw : undefined
  try {
    const answer = await resolveAnswer(text, user, mode)
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
  if (a.kind === 'drive') return { kind: 'drive', count: a.data.results.length }
  return { kind: 'menu', reason: a.reason }
}

async function resolveAnswer(text: string, user: ActingUser, mode?: CopilotModeId): Promise<GeneralAnswer> {
  // Drive search is user-scoped + read-only (no lead needed). Detected by the
  // same keyword rule Lead Mode uses; results are a factual file LIST — no
  // model produces the facts, so it stays within the deterministic model.
  if (detectsDriveIntent(text)) {
    const outcome = await maybePrefetchDrive({ question: text, userId: user.id })
    if (outcome) return { kind: 'drive', data: toDriveResults(outcome) }
    // Drive intent but search unavailable (not connected / transient error).
    return {
      kind: 'drive',
      data: { intro: 'לא הצלחתי לחפש ב-Google Drive. ודא שחיברת את החשבון.', mode: 'specific', results: [] },
    }
  }

  const c = await classifyGeneralIntent(text, user.agencyId, mode)

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
    case 'system.overview': {
      // One-line whole-system status from existing readers. NOT the briefing cards.
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

/** Maps the read-only Drive search outcome into the renderable card shape. */
function toDriveResults(outcome: DriveSearchOutcome): DriveResults {
  const count = outcome.results.length
  const intro =
    count === 0
      ? 'לא נמצאו קבצים תואמים ב-Google Drive.'
      : outcome.mode === 'generic'
        ? `הנה ${count} קבצים אחרונים ב-Google Drive שלך:`
        : `נמצאו ${count} קבצים תואמים ב-Google Drive:`
  return {
    intro,
    mode: outcome.mode,
    results: outcome.results.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      modifiedTime: r.modifiedTime,
      url: r.webViewLink ?? '',
      thumbnailUrl: r.thumbnailLink ?? undefined,
    })),
  }
}
