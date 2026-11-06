import { db } from '@/config/db'

/**
 * The meetings the Agent may read: the user's OWN meetings, in their agency, by
 * time window. Sessionless: the caller supplies agency and organizer from the
 * Agent's server-resolved scope.
 *
 * SAME VISIBILITY AS THE WEB CALENDAR (`listUpcomingMeetings` in db/meetings.ts
 * and actions/calendar/list.ts): agency + `organizer_user_id`, statuses
 * scheduled / completed / no_show, cancelled hidden. Only SocialCRM meetings;
 * events that exist only in Google Calendar are not here.
 *
 * The linked lead is joined ON BOTH id AND agency, so a stray `lead_id` can
 * never surface another tenant's lead name.
 */

export const AGENT_MEETING_STATUSES = ['scheduled', 'completed', 'no_show'] as const

export type AgentMeetingRow = {
  title: string
  startAt: Date
  endAt: Date
  status: (typeof AGENT_MEETING_STATUSES)[number]
  location: string | null
  leadId: number | null
  leadFirstName: string | null
  leadLastName: string | null
  leadStatus: string | null
}

export async function listOrganizerMeetings(input: {
  agencyId: number
  organizerUserId: number
  fromMs: number
  /** Exclusive; null = no upper bound. */
  toMs: number | null
  leadId?: number
  /** Rows returned; one more is read to report truncation. */
  limit: number
}): Promise<{ rows: AgentMeetingRow[]; truncated: boolean }> {
  const q = db('meetings as m')
    .leftJoin('clients as c', function () {
      this.on('c.id', '=', 'm.lead_id').andOn('c.agencyId', '=', 'm.agency_id')
    })
    .where('m.agency_id', input.agencyId)
    .where('m.organizer_user_id', input.organizerUserId)
    .whereIn('m.status', [...AGENT_MEETING_STATUSES])
    .where('m.start_at', '>=', new Date(input.fromMs))
  if (input.toMs !== null) q.where('m.start_at', '<', new Date(input.toMs))
  if (input.leadId !== undefined) q.where('m.lead_id', input.leadId)
  const rows = await q
    .orderBy([
      { column: 'm.start_at', order: 'asc' },
      { column: 'm.id', order: 'asc' },
    ])
    .limit(input.limit + 1)
    .select(
      'm.title as title',
      'm.start_at as startAt',
      'm.end_at as endAt',
      'm.status as status',
      'm.location as location',
      'c.id as leadId',
      'c.firstName as leadFirstName',
      'c.lastName as leadLastName',
      'c.status as leadStatus',
    )
  return { rows: (rows as AgentMeetingRow[]).slice(0, input.limit), truncated: rows.length > input.limit }
}
