'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { track } from '@/lib/analytics/track'
import { BRIEFING_SAMPLE_LIMIT } from '@/lib/copilot/general/constants'
import type { BriefingResult, BriefingSection } from '@/lib/copilot/general/types'

/**
 * Read-only daily briefing. FULLY DETERMINISTIC — no LLM on this path, so it
 * cannot fail or lag from a model dependency. Analytics is NOT in the success
 * path at all (only the error path emits, and `track` never throws), so a
 * broken analytics layer cannot affect what the user sees.
 */
export async function getDailyBriefing(): Promise<BriefingResult> {
  const user = await requireAgencyUser()
  try {
    const { gotPermIds } = await getPerms(user)
    const scope: Scope = { user: { role: user.role }, gotPermIds }

    // Empty-system onboarding. The client-side `opened` event already fired.
    if (!(await hasAnyLeads(user.agencyId, gotPermIds, user.role))) {
      return { kind: 'empty' }
    }

    const [dueToday, stale, overdue, meetings, newThisWeek, inbox] = await Promise.all([
      getFollowUpsDueToday(scope).catch(() => ({ total: 0, sample: [] })),
      getLeadsNotContactedRecently(scope).catch(() => ({ total: 0, sample: [] })),
      getOverdueTaskSummary(scope).catch(() => ({ total: 0, sample: [] })),
      getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }).catch(() => []),
      getNewLeadsThisWeek(scope).catch(() => ({ total: 0, sample: [] })),
      getUnreadInboxSummary(scope).catch(() => ({ conversations: 0, unread: 0 })),
    ])

    // getTodaysMeetings is unbounded; apply the same hard cap here.
    const meetingSample = meetings
      .slice(0, BRIEFING_SAMPLE_LIMIT)
      .map((m) => ({ id: m.id, title: m.title, startAt: m.startAt, leadName: m.leadName }))

    // Urgency-first triage order: overdue → due-today → meetings → inbox → stale → new.
    const sections: BriefingSection[] = [
      { id: 'tasks.overdue', total: overdue.total, sample: overdue.sample },
      { id: 'followups.dueToday', total: dueToday.total, sample: dueToday.sample },
      { id: 'meetings.today', total: meetings.length, sample: meetingSample },
      { id: 'inbox.unread', conversations: inbox.conversations, unread: inbox.unread },
      { id: 'leads.notContactedRecently', total: stale.total, sample: stale.sample },
      { id: 'leads.newThisWeek', total: newThisWeek.total, sample: newThisWeek.sample },
    ]

    return { kind: 'briefing', greeting: buildDeterministicSummary(sections), sections }
  } catch (err) {
    // Analytics is best-effort and isolated from the thrown failure.
    await track({ agencyId: user.agencyId, userId: user.id, event: 'general_mode.error', props: { stage: 'briefing' } })
    throw err
  }
}

/**
 * Deterministic one-line Hebrew summary over the TRUE totals only. No LLM → no
 * latency, no token spend, no failure path. Pure interpretation of real
 * numbers; never invents a fact.
 */
function buildDeterministicSummary(sections: BriefingSection[]): string {
  const parts: string[] = []
  for (const s of sections) {
    if (s.id === 'tasks.overdue' && s.total > 0) parts.push(`${s.total} משימות באיחור`)
    else if (s.id === 'followups.dueToday' && s.total > 0) parts.push(`${s.total} מעקבים להיום`)
    else if (s.id === 'meetings.today' && s.total > 0) parts.push(`${s.total} פגישות`)
    else if (s.id === 'inbox.unread' && s.unread > 0) parts.push(`${s.unread} הודעות שלא נקראו`)
  }
  if (parts.length === 0) return 'אין משימות דחופות להיום. זמן טוב לחזור ללידים שלא בקשר.'
  return `היום: ${parts.join(' · ')}.`
}
