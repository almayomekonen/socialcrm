'use server'

import { ProductAccessError, requireProductAccess } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getTodaysMeetings } from '@/db/meetings'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  getUnreadInboxSummary,
  type Scope,
} from '@/db/briefing'
import { track } from '@/lib/analytics/track'
import { BRIEFING_SAMPLE_LIMIT } from '@/lib/copilot/general/constants'
import type { BriefingResult, BriefingSection } from '@/lib/copilot/general/types'

/**
 * ENTITLEMENT IS AN OUTCOME HERE, NOT AN EXCEPTION.
 *
 * `requireProductAccess` is unchanged and still the only thing deciding access —
 * this catches its typed refusal and turns it into a value the UI can render.
 * The panel mounts on every app route, so with the throw escaping, a lapsed
 * subscription produced an unhandled Server Action rejection that Next masks as
 * an opaque 500 (React #441) on EVERY page load. A live production audit caught
 * two per page. The customer saw nothing wrong — the panel already showed the
 * locked state from the client entitlement context — so the errors were pure
 * server noise for an expected business state.
 *
 * Only `ProductAccessError` is converted. Everything else still throws: a real
 * bug must not be laundered into a calm "locked" card.
 *
 * No AI call is made on this path, and none was made before it — the briefing is
 * assembled deterministically from CRM rows.
 */
export async function getDailyBriefing(): Promise<BriefingResult> {
  const user = await requireProductAccess().catch((err) => {
    if (err instanceof ProductAccessError) return null
    throw err
  })
  if (!user) return { kind: 'locked' }
  try {
    const { gotPermIds } = await getPerms(user)
    const scope: Scope = { user: { role: user.role }, gotPermIds }

    if (!(await hasAnyLeads(user.agencyId, gotPermIds, user.role))) {
      return { kind: 'empty' }
    }

    const [promisedWaiting, dueToday, stale, overdue, meetings, newThisWeek, inbox] = await Promise.all([
      getPromisedButWaiting(scope).catch(() => ({ total: 0, sample: [] })),
      getFollowUpsDueToday(scope).catch(() => ({ total: 0, sample: [] })),
      getLeadsNotContactedRecently(scope).catch(() => ({ total: 0, sample: [] })),
      getOverdueTaskSummary(scope).catch(() => ({ total: 0, sample: [] })),
      getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }).catch(() => []),
      getNewLeadsThisWeek(scope).catch(() => ({ total: 0, sample: [] })),
      getUnreadInboxSummary(scope).catch(() => ({ conversations: 0, unread: 0 })),
    ])

    const meetingSample = meetings
      .slice(0, BRIEFING_SAMPLE_LIMIT)
      .map((m) => ({ id: m.id, title: m.title, startAt: m.startAt, leadName: m.leadName }))

    const sections: BriefingSection[] = [
      ...(promisedWaiting.total > 0
        ? [{ id: 'followups.promisedWaiting' as const, total: promisedWaiting.total, sample: promisedWaiting.sample }]
        : []),
      { id: 'tasks.overdue', total: overdue.total, sample: overdue.sample },
      { id: 'followups.dueToday', total: dueToday.total, sample: dueToday.sample },
      { id: 'meetings.today', total: meetings.length, sample: meetingSample },
      { id: 'inbox.unread', conversations: inbox.conversations, unread: inbox.unread },
      { id: 'leads.notContactedRecently', total: stale.total, sample: stale.sample },
      { id: 'leads.newThisWeek', total: newThisWeek.total, sample: newThisWeek.sample },
    ]

    return { kind: 'briefing', greeting: buildDeterministicSummary(sections), sections }
  } catch (err) {
    await track({ agencyId: user.agencyId, userId: user.id, event: 'general_mode.error', props: { stage: 'briefing' } })
    throw err
  }
}

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
