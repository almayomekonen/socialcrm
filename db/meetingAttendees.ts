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

/**
 * Replace the full attendee list for a meeting in a single transaction.
 * Used by the update path: Google's events.patch contract is that the
 * `attendees` field, if present in the body, REPLACES the existing list —
 * we mirror that semantics on our side.
 *
 * Attendee lists are small (typically <10), so delete-then-insert is
 * simpler and correct vs. computing a diff.
 */
export async function replaceAttendees(meetingId: number, attendees: AttendeeInput[]): Promise<void> {
  await db.transaction(async (trx) => {
    await trx('meeting_attendees').where({ meeting_id: meetingId }).del()
    if (attendees.length === 0) return
    const rows = attendees
      .map((a) => normalizeAttendee(meetingId, a))
      .filter((a): a is NonNullable<typeof a> => a !== null)
    if (rows.length === 0) return
    await trx('meeting_attendees').insert(rows).onConflict(['meeting_id', 'email']).ignore()
  })
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
