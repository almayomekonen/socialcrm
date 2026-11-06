import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { listOrganizerMeetings } from '@/db/agentMeetings'
import { MEETING_PERIODS, meetingRange } from '../meetingRange'
import { businessDateString, formatBusinessLongDate, formatBusinessTime } from '@/lib/today/time'
import { entityRef } from '../evidence'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 11 — the user's own meetings in a time window.
 *
 * "מה יש לי היום", "יש לי פגישות מחר?", "תראה לי את הפגישות של השבוע", "יש לי
 * פגישה עם אבי?", "מה הפגישה הבאה שלי?".
 *
 * WHO. The scope's own user as organizer, in the scope's agency, exactly as the
 * web calendar shows them (db/agentMeetings.ts). The model never supplies an
 * agency, a user or an instant: it names a PERIOD, and the window is computed
 * here in the business timezone (../meetingRange.ts).
 *
 * WHAT IS RETURNED. Title, business-time date and hours, meeting status, place,
 * and the linked lead's name and pipeline status. No meeting id, no lead id, no
 * description and no internal notes; a linked lead is cited by its evidence ref
 * only. A count is recorded as the `meetings.count` metric over the window, so
 * "אין לך פגישות מחר" is a cited observation, not a guess.
 */

export const MEETING_METRIC_IDS = ['meetings.count'] as const

const MAX_MEETINGS = 20

const STATUS_LABEL = { scheduled: 'מתוכננת', completed: 'התקיימה', no_show: 'הליד לא הגיע' } as const

const PERIOD_LABEL: Record<(typeof MEETING_PERIODS)[number], string> = {
  today: 'היום',
  tomorrow: 'מחר',
  date: 'תאריך מסוים',
  this_week: 'השבוע (ראשון עד שבת)',
  next_week: 'השבוע הבא (ראשון עד שבת)',
  next_7_days: 'שבעת הימים הקרובים',
  upcoming: 'הפגישות הבאות',
}

export function makeListMeetings(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget; nowMs: number }) {
  return tool({
    description:
      "The user's own SocialCRM meetings in a period, in time order: title, day, start and end time, meeting status (מתוכננת / התקיימה / הליד לא הגיע), place, and the linked lead's name and status. Use it for any question about meetings or the calendar: today, tomorrow, a specific date, this week, next week, the next 7 days, or the next meetings from now (period=upcoming; the first result is the next meeting). To ask about meetings with one lead, first get their leadId from find_lead and pass it. Cancelled meetings and events that exist only in Google Calendar are not included.",
    inputSchema: z.object({
      period: z.enum(MEETING_PERIODS),
      date: z.string().optional().describe('YYYY-MM-DD, only with period=date'),
      leadId: z.number().int().positive().optional().describe('Only meetings linked to this lead. An id from an earlier tool result, never invented.'),
    }),
    execute: async ({ period, date, leadId }) => {
      const verdict = deps.budget.canStep('list_meetings', `${period}:${date ?? ''}:${leadId ?? ''}`)
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const range = meetingRange(period, deps.nowMs, date)
      if (!range) {
        const payload = { invalidDate: true as const, reason: 'period=date needs a real calendar date as YYYY-MM-DD.' }
        deps.budget.noteResult(JSON.stringify(payload))
        return payload
      }

      const { rows, truncated } = await listOrganizerMeetings({
        agencyId: deps.scope.agencyId,
        organizerUserId: deps.scope.userId,
        fromMs: range.fromMs,
        toMs: range.toMs,
        leadId,
        limit: MAX_MEETINGS,
      })

      const window = { from: range.fromDate, to: range.toDate ?? businessDateString(deps.nowMs) }
      deps.evidence.add({ kind: 'metric', metric: 'meetings.count', window, n: rows.length })

      const meetings = rows.map((m) => {
        const startMs = new Date(m.startAt).getTime()
        const leadName = [m.leadFirstName, m.leadLastName].filter(Boolean).join(' ').trim() || null
        if (m.leadId) deps.evidence.add({ kind: 'lead', refId: String(m.leadId) })
        return {
          title: m.title,
          day: formatBusinessLongDate(m.startAt),
          date: businessDateString(startMs),
          start: formatBusinessTime(m.startAt),
          end: formatBusinessTime(m.endAt),
          alreadyStarted: startMs <= deps.nowMs,
          status: STATUS_LABEL[m.status] ?? m.status,
          location: m.location || null,
          lead: m.leadId ? { name: leadName, status: m.leadStatus ?? null, evidenceRef: entityRef('lead', m.leadId) } : null,
        }
      })

      const payload = {
        period,
        periodLabel: PERIOD_LABEL[period],
        from: range.fromDate,
        ...(range.toDate ? { to: range.toDate } : {}),
        timezone: 'Asia/Jerusalem',
        count: meetings.length,
        /** More meetings exist in the window than are listed. Say so; never present the list as complete. */
        truncated,
        meetings,
        scope: "meetings this user organizes in SocialCRM; cancelled meetings and Google-only events are not included",
        metric: 'meetings.count',
      }
      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
