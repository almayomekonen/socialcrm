'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingPatched,
  updateMeetingMutableFields,
  updateMeetingSyncState,
} from '@/db/meetings'
import { getAttendeesForMeeting, replaceAttendees } from '@/db/meetingAttendees'
import {
  CalendarApiError,
  updateEvent,
  type UpdateEventInput,
} from '@/lib/integrations/google/calendarClient'
import { CalendarAuthError } from '@/lib/integrations/google/calendarTokens'
import { classifyError, normalizeAttendees, rescheduleAppointmentReminders, toDate } from './shared'

// Richer than MeetingSummaryDTO — includes attendees and timezone, used by
// the edit dialog to prefill the form. Kept separate so listUpcomingMeetings
// stays cheap (no per-meeting attendee join).
export type MeetingEditDTO = {
  id: number
  leadId: number | null
  title: string
  location: string | null
  timezone: string
  startAt: string
  endAt: string
  attendees: Array<{ email: string; displayName: string | null }>
}

export type GetMeetingForEditResult =
  | { ok: true; meeting: MeetingEditDTO }
  | { ok: false; reason: 'invalid_input' | 'not_found' | 'not_owner' }

export async function getMeetingForEdit(meetingIdRaw: number | string): Promise<GetMeetingForEditResult> {
  const meetingId = Number(meetingIdRaw)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }
  const user = await requireProductAccess()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }

  const attendees = await getAttendeesForMeeting(meetingId)
  return {
    ok: true,
    meeting: {
      id: meeting.id,
      leadId: meeting.lead_id,
      title: meeting.title,
      location: meeting.location,
      timezone: meeting.timezone,
      startAt: meeting.start_at instanceof Date
        ? meeting.start_at.toISOString()
        : new Date(meeting.start_at).toISOString(),
      endAt: meeting.end_at instanceof Date
        ? meeting.end_at.toISOString()
        : new Date(meeting.end_at).toISOString(),
      // Filter out organizer rows — they're auto-added by Google, not
      // something the user manages from the form. (The current insert path
      // doesn't write organizer rows anyway; this filter is defensive for
      // when Task 7's refresh starts populating them.)
      attendees: attendees
        .filter((a) => !a.is_organizer)
        .map((a) => ({ email: a.email, displayName: a.display_name })),
    },
  }
}

export type UpdateMeetingInput = {
  meetingId: number | string
  title?: string
  description?: string | null
  internalNotes?: string | null
  location?: string | null
  startAt?: string | Date
  endAt?: string | Date
  timezone?: string
  attendees?: Array<{ email: string; displayName?: string | null }>
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

/**
 * IMPORTANT: `ok: true` means the CRM accepted the edit. It does NOT
 * guarantee the change reached Google.
 *
 *   - syncStatus='synced'          → CRM + Google both updated
 *   - syncStatus='not_synced'      → CRM updated; meeting never had a
 *                                     google_event_id (still pending)
 *   - syncStatus='failed'          → CRM updated; Google patch failed
 *                                     (transient: will be retried)
 *   - syncStatus='reauth_required' → CRM updated; OAuth needs reconnect
 *
 * Callers (e.g. the future drag handler) MUST inspect syncStatus, not just
 * `ok`, before reporting success to the user.
 *
 * `ok: false` + reason='conflict' is the etag-mismatch path: another writer
 * changed the event since we last fetched. The action does NOT auto-resolve.
 */
export type UpdateMeetingResult =
  | {
      ok: true
      meetingId: number
      syncStatus: 'synced' | 'not_synced' | 'failed' | 'reauth_required'
      meetUrl: string | null
    }
  | { ok: false; reason: 'invalid_input' | 'not_found' | 'not_owner' | 'conflict'; details?: string }

export async function updateMeeting(input: UpdateMeetingInput): Promise<UpdateMeetingResult> {
  const meetingId = Number(input.meetingId)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input', details: 'meetingId' }
  }

  // Validate the easy stuff before hitting the DB.
  if (input.title !== undefined) {
    const trimmed = input.title.trim()
    if (!trimmed) return { ok: false, reason: 'invalid_input', details: 'title' }
  }
  if (input.timezone !== undefined && (!input.timezone || typeof input.timezone !== 'string')) {
    return { ok: false, reason: 'invalid_input', details: 'timezone' }
  }

  const startAtNew = input.startAt !== undefined ? toDate(input.startAt) : undefined
  const endAtNew = input.endAt !== undefined ? toDate(input.endAt) : undefined
  if (input.startAt !== undefined && !startAtNew) {
    return { ok: false, reason: 'invalid_input', details: 'startAt' }
  }
  if (input.endAt !== undefined && !endAtNew) {
    return { ok: false, reason: 'invalid_input', details: 'endAt' }
  }

  const user = await requireProductAccess()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }
  if (meeting.status === 'cancelled') {
    return { ok: false, reason: 'invalid_input', details: 'cancelled' }
  }

  const effectiveStart = startAtNew ?? meeting.start_at
  const effectiveEnd = endAtNew ?? meeting.end_at
  if (effectiveEnd.getTime() <= effectiveStart.getTime()) {
    return { ok: false, reason: 'invalid_input', details: 'end_before_start' }
  }

  if (effectiveEnd.getTime() - effectiveStart.getTime() < 5 * 60 * 1000) {
    return { ok: false, reason: 'invalid_input', details: 'duration_too_short' }
  }

  const normalizedAttendees = input.attendees !== undefined ? normalizeAttendees(input.attendees) : undefined

  const safeTitle = input.title !== undefined ? input.title.trim().slice(0, 255) : undefined
  const safeDescription = input.description !== undefined ? (input.description?.slice(0, 5000) ?? null) : undefined
  const safeLocation = input.location !== undefined ? (input.location?.slice(0, 255) ?? null) : undefined
  const safeInternalNotes = input.internalNotes !== undefined ? (input.internalNotes?.slice(0, 5000) ?? null) : undefined

  // --- 1. CRM write first (source of truth) -----------------------------
  await updateMeetingMutableFields(meetingId, user.agencyId, {
    title: safeTitle,
    description: safeDescription,
    location: safeLocation,
    internalNotes: safeInternalNotes,
    startAt: startAtNew,
    endAt: endAtNew,
    timezone: input.timezone,
  })
  if (normalizedAttendees !== undefined) {
    await replaceAttendees(meetingId, normalizedAttendees)
  }

  /**
   * The reminder follows the meeting.
   *
   * Only when the START TIME actually moved: that is the only field a reminder's
   * schedule depends on. Title, location and the Meet link are read LIVE at send
   * time, so editing them needs no requeue — the already-queued job will pick
   * them up on its own.
   *
   * Done here, after the CRM write and before the Google patch, for the same
   * reason the create path emits there: the CRM is the source of truth, and
   * whether Google accepted the change must not decide whether the reminder is
   * correct.
   */
  const startMoved = startAtNew !== undefined && startAtNew.getTime() !== meeting.start_at.getTime()
  if (startMoved) {
    await rescheduleAppointmentReminders({
      agencyId: user.agencyId,
      meetingId,
      leadId: meeting.lead_id,
      startAt: startAtNew,
      title: safeTitle ?? meeting.title,
    })
  }

  // --- 2. Google patch (skipped if never synced) ------------------------
  if (!meeting.google_event_id) {
    revalidatePath('/calendar')
    if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
    return { ok: true, meetingId, syncStatus: 'not_synced', meetUrl: meeting.meet_url }
  }

  const googleTimezone = input.timezone ?? meeting.timezone
  const patchInput: UpdateEventInput = {
    userId: user.id,
    googleEventId: meeting.google_event_id,
    // Etag enforcement is suspended for Phase 1. Google bumps the etag
    // asynchronously after Meet provisioning, so the etag we captured at
    // events.insert is stale almost immediately — every subsequent patch
    // would get a false-positive 412. Restore once Task 7 lands getEvent
    // and we can refresh-then-retry on real conflicts. We still STORE etag
    // (markMeetingPatched / updateMeetingSyncState) so the data is ready.
    etag: null,
    sendUpdates: input.sendUpdates ?? 'all',
    timezone: input.timezone, // only sent if caller provided it
  }
  if (safeTitle !== undefined) patchInput.title = safeTitle
  if (safeDescription !== undefined) patchInput.description = safeDescription
  if (safeLocation !== undefined) patchInput.location = safeLocation
  if (startAtNew !== undefined) {
    patchInput.startAt = startAtNew
    patchInput.timezone = googleTimezone
  }
  if (endAtNew !== undefined) {
    patchInput.endAt = endAtNew
    patchInput.timezone = googleTimezone
  }
  if (normalizedAttendees !== undefined) {
    patchInput.attendees = normalizedAttendees
  }

  try {
    const result = await updateEvent(patchInput)
    await markMeetingPatched(meetingId, user.agencyId, result.etag)
    revalidatePath('/calendar')
    if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
    return { ok: true, meetingId, syncStatus: 'synced', meetUrl: result.meetLink }
  } catch (err) {
    if (err instanceof CalendarApiError && err.reason === 'etag_mismatch') {
      revalidatePath('/calendar')
      if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
      return { ok: false, reason: 'conflict' }
    }
    const { syncStatus, code } = classifyError(err)
    await updateMeetingSyncState(meetingId, { status: syncStatus, syncError: `patch:${code}` })
    if (!(err instanceof CalendarAuthError) && !(err instanceof CalendarApiError)) {
      console.warn('[calendar.patch] unexpected error', {
        meetingId,
        error: (err as Error)?.message,
      })
    }
    revalidatePath('/calendar')
    if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
    return { ok: true, meetingId, syncStatus, meetUrl: meeting.meet_url }
  }
}
