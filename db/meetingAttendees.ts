import { db } from '@/config/db'

export type ResponseStatus = 'needsAction' | 'accepted' | 'declined' | 'tentative'

export type MeetingAttendeeRow = {
  id: number
  meeting_id: number
  email: string
  display_name: string | null
  user_id: number | null
  lead_id: number | null
  response_status: ResponseStatus
  is_organizer: boolean
  created_at: Date
}

export type AttendeeInput = {
  email: string
  displayName?: string | null
  userId?: number | null
  leadId?: number | null
  isOrganizer?: boolean
}

/**
 * Append attendees to a meeting. Email is normalized (trim + lowercase) so
 * the (meeting_id, email) unique constraint behaves predictably. Re-adding
 * the same attendee is a silent no-op via .onConflict().ignore().
 */
export async function insertAttendees(
  meetingId: number,
  attendees: AttendeeInput[],
): Promise<void> {
  if (attendees.length === 0) return
  const rows = attendees
    .map((a) => normalizeAttendee(meetingId, a))
    .filter((a): a is NonNullable<typeof a> => a !== null)
  if (rows.length === 0) return
  await db('meeting_attendees').insert(rows).onConflict(['meeting_id', 'email']).ignore()
}

export async function getAttendeesForMeeting(meetingId: number): Promise<MeetingAttendeeRow[]> {
  const rows = await db('meeting_attendees').where({ meeting_id: meetingId }).orderBy('id', 'asc')
  return rows as MeetingAttendeeRow[]
}

function normalizeAttendee(
  meetingId: number,
  input: AttendeeInput,
): {
  meeting_id: number
  email: string
  display_name: string | null
  user_id: number | null
  lead_id: number | null
  is_organizer: boolean
} | null {
  const email = input.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  return {
    meeting_id: meetingId,
    email: email.slice(0, 255),
    display_name: input.displayName?.slice(0, 255) ?? null,
    user_id: input.userId ?? null,
    lead_id: input.leadId ?? null,
    is_organizer: input.isOrganizer ?? false,
  }
}
