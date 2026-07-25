'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { getMeeting, markMeetingCancelled, updateMeetingSyncState } from '@/db/meetings'
import { deleteEvent } from '@/lib/integrations/google/calendarClient'
import { classifyError, type ActionError } from './shared'

export type CancelMeetingError = ActionError | 'has_outcome'

export type CancelMeetingResult =
  | { ok: true; syncStatus: 'synced' | 'failed' | 'reauth_required' }
  | { ok: false; reason: CancelMeetingError }

export async function cancelMeeting(meetingIdRaw: number | string): Promise<CancelMeetingResult> {
  const meetingId = Number(meetingIdRaw)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireProductAccess()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }
  if (meeting.status === 'cancelled') return { ok: true, syncStatus: 'synced' }
  if (meeting.status === 'completed' || meeting.status === 'no_show') {
    return { ok: false, reason: 'has_outcome' }
  }

  await markMeetingCancelled(meetingId, user.agencyId)

  let syncStatus: 'synced' | 'failed' | 'reauth_required' = 'synced'
  if (meeting.google_event_id) {
    try {
      await deleteEvent({ userId: user.id, googleEventId: meeting.google_event_id })
    } catch (err) {
      const { syncStatus: s, code } = classifyError(err)
      syncStatus = s
      await updateMeetingSyncState(meetingId, { status: s, syncError: `cancel:${code}` })
    }
  }

  revalidatePath('/calendar')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
  return { ok: true, syncStatus }
}
