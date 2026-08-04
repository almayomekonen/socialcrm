'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { getFullLead } from '@/db/clients'
import { insertMeeting } from '@/db/meetings'
import { insertAttendees } from '@/db/meetingAttendees'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { occurrenceKeyForMeeting } from '@/lib/automations/appointments'
import {
  INVITE_DIAG,
  normalizeAttendees,
  pushMeetingToGoogle,
  toDate,
  type ActionError,
} from './shared'

export type CreateMeetingInput = {
  leadId?: number | null
  title: string
  description?: string | null
  location?: string | null
  startAt: string | Date
  endAt: string | Date
  timezone: string
  attendees?: Array<{ email: string; displayName?: string | null }>
}

export type CreateMeetingResult =
  | {
      ok: true
      meetingId: number
      meetUrl: string | null
      syncStatus: 'synced' | 'failed' | 'reauth_required'
    }
  | { ok: false; reason: ActionError; details?: string }

export async function createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult> {
  const title = input.title?.trim()
  if (!title) return { ok: false, reason: 'invalid_input', details: 'title' }
  const startAt = toDate(input.startAt)
  const endAt = toDate(input.endAt)
  if (!startAt || !endAt) return { ok: false, reason: 'invalid_input', details: 'dates' }
  if (endAt.getTime() <= startAt.getTime()) {
    return { ok: false, reason: 'invalid_input', details: 'end_before_start' }
  }
  if (!input.timezone || typeof input.timezone !== 'string') {
    return { ok: false, reason: 'invalid_input', details: 'timezone' }
  }

  const user = await requireProductAccess()

  let leadId: number | null = null
  if (input.leadId != null) {
    const id = Number(input.leadId)
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, reason: 'invalid_input', details: 'lead' }
    }
    const lead = await getFullLead({ id, select: ['name'] }).catch(() => null)
    if (!lead?.name) return { ok: false, reason: 'lead_not_found' }
    leadId = id
  }

  const safeTitle = title.slice(0, 255)
  const safeDescription = input.description?.slice(0, 5000) ?? null
  const safeLocation = input.location?.slice(0, 255) ?? null

  const meetingId = await insertMeeting({
    agencyId: user.agencyId,
    organizerUserId: user.id,
    leadId,
    title: safeTitle,
    description: safeDescription,
    location: safeLocation,
    timezone: input.timezone,
    startAt,
    endAt,
  })

  const attendees = normalizeAttendees(input.attendees ?? [])
  if (attendees.length > 0) {
    await insertAttendees(meetingId, attendees)
  }

  if (INVITE_DIAG) {
    console.info('[calendar.invite.diag] action.createMeeting', {
      meetingId,
      userId: user.id,
      leadId,
      title: safeTitle,
      timezone: input.timezone,
      rawAttendeesInput: input.attendees ?? [],
      rawAttendeeCount: input.attendees?.length ?? 0,
      normalizedAttendees: attendees,
      normalizedAttendeeCount: attendees.length,
      droppedCount: (input.attendees?.length ?? 0) - attendees.length,
    })
  }
  // === /TEMP DIAG ===

  /**
   * Customer Automation Engine trigger — the Meetings domain is the SOURCE of
   * the appointment occurrence. No calendar provider is in this path: the
   * meeting already exists in the CRM and the lead is already attached to it,
   * which is why Law 2 ("exactly one Lead") is satisfied by construction rather
   * than by matching an email against the lead table.
   *
   * Emitted BEFORE the Google push and outside it: the occurrence is true the
   * moment the row exists, and whether Google accepted the mirror is a sync
   * concern that must not decide whether the lead gets a reminder.
   *
   * A meeting with no lead emits nothing — there is no one to remind.
   * `emitAutomationEvent` never throws, so it cannot cost the user their meeting.
   */
  if (leadId) {
    await emitAutomationEvent({
      trigger: 'appointment_booked',
      origin: 'manual',
      agencyId: user.agencyId,
      leadId,
      occurredAt: new Date(),
      occurrenceKey: occurrenceKeyForMeeting(meetingId),
      fields: {
        // The anchor a before-anchor timing resolves against, and the snapshot
        // of what was booked.
        startsAt: startAt,
        appointmentName: safeTitle,
        inviteeEmail: attendees[0]?.email ?? null,
      },
    })
  }

  const outcome = await pushMeetingToGoogle({
    meetingId,
    userId: user.id,
    title: safeTitle,
    description: safeDescription,
    location: safeLocation,
    startAt,
    endAt,
    timezone: input.timezone,
    attendees,
  })

  revalidatePath('/calendar')
  if (leadId) revalidatePath(`/clients/${leadId}`)

  return { ok: true, meetingId, meetUrl: outcome.meetUrl, syncStatus: outcome.syncStatus }
}
