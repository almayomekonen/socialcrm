'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { getMeeting } from '@/db/meetings'
import { getAttendeesForMeeting } from '@/db/meetingAttendees'
import { pushMeetingToGoogle, type ActionError } from './shared'

export type RetrySyncMeetingResult =
  | { ok: true; meetUrl: string | null; syncStatus: 'synced' | 'failed' | 'reauth_required' }
  | { ok: false; reason: ActionError }

export async function retrySyncMeeting(meetingIdRaw: number | string): Promise<RetrySyncMeetingResult> {
  const meetingId = Number(meetingIdRaw)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireProductAccess()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }
  if (meeting.status !== 'scheduled') return { ok: false, reason: 'already_synced' }

  if (meeting.google_event_id) {
    return meeting.sync_status === 'synced'
      ? { ok: true, meetUrl: meeting.meet_url, syncStatus: 'synced' }
      : { ok: false, reason: 'already_synced' }
  }

  const attendees = await getAttendeesForMeeting(meetingId)
  const outcome = await pushMeetingToGoogle({
    meetingId,
    userId: user.id,
    title: meeting.title,
    description: meeting.description,
    location: meeting.location,
    startAt: meeting.start_at instanceof Date ? meeting.start_at : new Date(meeting.start_at),
    endAt: meeting.end_at instanceof Date ? meeting.end_at : new Date(meeting.end_at),
    timezone: meeting.timezone,
    attendees: attendees.filter((a) => !a.is_organizer).map((a) => ({ email: a.email, displayName: a.display_name })),
  })

  revalidatePath('/calendar')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
  return { ok: true, meetUrl: outcome.meetUrl, syncStatus: outcome.syncStatus }
}
