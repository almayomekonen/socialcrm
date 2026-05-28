'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { getFullLead } from '@/db/clients'
import {
  getMeeting,
  insertMeeting,
  listUpcomingMeetings as dbListUpcomingMeetings,
  markMeetingCancelled,
  updateMeetingSyncState,
  type MeetingRow,
} from '@/db/meetings'
import { getAttendeesForMeeting, insertAttendees } from '@/db/meetingAttendees'
import {
  createEvent,
  deleteEvent,
  CalendarApiError,
} from '@/lib/integrations/google/calendarClient'
import { CalendarAuthError } from '@/lib/integrations/google/calendarTokens'

export type MeetingSummaryDTO = {
  id: number
  leadId: number | null
  title: string
  location: string | null
  timezone: string
  startAt: string
  endAt: string
  status: 'scheduled' | 'cancelled' | 'completed'
  meetUrl: string | null
  syncStatus: 'pending' | 'synced' | 'failed' | 'reauth_required'
  syncError: string | null
}

export type ActionError =
  | 'invalid_input'
  | 'lead_not_found'
  | 'not_found'
  | 'not_owner'
  | 'already_synced'

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

  const user = await requireAgencyUser()

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

  // Normalize once at the action boundary: trim, lowercase, drop malformed,
  // dedupe. The DB has a unique (meeting_id, email) constraint and would
  // dedupe on insert, but we also send this list to Google — sending dupes
  // there is harmless but ugly, and sending malformed addresses causes the
  // whole insert to 400. Filter aggressively.
  const attendees = normalizeAttendees(input.attendees ?? [])
  if (attendees.length > 0) {
    await insertAttendees(meetingId, attendees)
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

export type CancelMeetingResult =
  | { ok: true; syncStatus: 'synced' | 'failed' | 'reauth_required' }
  | { ok: false; reason: ActionError }

export async function cancelMeeting(meetingIdRaw: number | string): Promise<CancelMeetingResult> {
  const meetingId = Number(meetingIdRaw)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireAgencyUser()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }
  if (meeting.status === 'cancelled') return { ok: true, syncStatus: 'synced' }

  // CRM is source of truth — cancel locally first, then mirror to Google.
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

export type RetrySyncMeetingResult =
  | { ok: true; meetUrl: string | null; syncStatus: 'synced' | 'failed' | 'reauth_required' }
  | { ok: false; reason: ActionError }

export async function retrySyncMeeting(
  meetingIdRaw: number | string,
): Promise<RetrySyncMeetingResult> {
  const meetingId = Number(meetingIdRaw)
  if (!Number.isFinite(meetingId) || meetingId <= 0) {
    return { ok: false, reason: 'invalid_input' }
  }

  const user = await requireAgencyUser()
  const meeting = await getMeeting(meetingId, user.agencyId)
  if (!meeting) return { ok: false, reason: 'not_found' }
  if (meeting.organizer_user_id !== user.id) return { ok: false, reason: 'not_owner' }
  if (meeting.status !== 'scheduled') return { ok: false, reason: 'already_synced' }

  // Phase 1 only re-pushes meetings that have NEVER been synced. If
  // google_event_id is already set, a second insert would duplicate the
  // Google event (events.insert isn't idempotent on iCalUID). That recovery
  // path waits for Phase 2's pre-write getEvent check.
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
    attendees: attendees
      .filter((a) => !a.is_organizer)
      .map((a) => ({ email: a.email, displayName: a.display_name })),
  })

  revalidatePath('/calendar')
  if (meeting.lead_id) revalidatePath(`/clients/${meeting.lead_id}`)
  return { ok: true, meetUrl: outcome.meetUrl, syncStatus: outcome.syncStatus }
}

export async function listUpcomingMeetings(input?: {
  limit?: number
  fromAt?: string | Date
}): Promise<MeetingSummaryDTO[]> {
  const user = await requireAgencyUser()
  const fromAt = input?.fromAt ? toDate(input.fromAt) : new Date()
  const rows = await dbListUpcomingMeetings({
    agencyId: user.agencyId,
    organizerUserId: user.id,
    limit: input?.limit,
    fromAt: fromAt ?? new Date(),
  })
  return rows.map(toSummary)
}

// ---------- internal helpers ----------

type PushOutcome = {
  meetUrl: string | null
  syncStatus: 'synced' | 'failed' | 'reauth_required'
}

async function pushMeetingToGoogle(input: {
  meetingId: number
  userId: number
  title: string
  description: string | null
  location: string | null
  startAt: Date
  endAt: Date
  timezone: string
  attendees: Array<{ email: string; displayName: string | null }>
}): Promise<PushOutcome> {
  try {
    const result = await createEvent({
      userId: input.userId,
      meetingId: input.meetingId,
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      attendees: input.attendees,
    })
    await updateMeetingSyncState(input.meetingId, {
      status: 'synced',
      googleEventId: result.googleEventId,
      googleIcalUid: result.googleIcalUid,
      meetUrl: result.meetLink,
    })
    return { meetUrl: result.meetLink, syncStatus: 'synced' }
  } catch (err) {
    const { syncStatus, code } = classifyError(err)
    await updateMeetingSyncState(input.meetingId, {
      status: syncStatus,
      syncError: `push:${code}`,
    })
    if (!(err instanceof CalendarAuthError) && !(err instanceof CalendarApiError)) {
      console.warn('[calendar.push] unexpected error', {
        meetingId: input.meetingId,
        error: (err as Error)?.message,
      })
    }
    return { meetUrl: null, syncStatus }
  }
}

function classifyError(err: unknown): {
  syncStatus: 'failed' | 'reauth_required'
  code: string
} {
  if (err instanceof CalendarAuthError) {
    const isReauth =
      err.reason === 'reauth_required' ||
      err.reason === 'missing_scope' ||
      err.reason === 'not_connected'
    return { syncStatus: isReauth ? 'reauth_required' : 'failed', code: `auth:${err.reason}` }
  }
  if (err instanceof CalendarApiError) {
    const isReauth = err.reason === 'reauth_required' || err.reason === 'missing_scope'
    return {
      syncStatus: isReauth ? 'reauth_required' : 'failed',
      code: `api:${err.reason}:${err.status}`,
    }
  }
  return { syncStatus: 'failed', code: `unknown:${(err as Error)?.message?.slice(0, 100) ?? ''}` }
}

// RFC 5321 production-acceptable email regex (length-bounded, single-@).
// Not RFC-perfect, but enough to keep Google from rejecting our insert.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,255}$/

function normalizeAttendees(
  raw: Array<{ email: string; displayName?: string | null }>,
): Array<{ email: string; displayName: string | null }> {
  const seen = new Set<string>()
  const out: Array<{ email: string; displayName: string | null }> = []
  for (const a of raw) {
    const email = a.email?.trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue
    seen.add(email)
    out.push({ email, displayName: a.displayName ?? null })
  }
  return out
}

function toDate(value: string | Date | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function toSummary(row: MeetingRow): MeetingSummaryDTO {
  return {
    id: row.id,
    leadId: row.lead_id,
    title: row.title,
    location: row.location,
    timezone: row.timezone,
    startAt: row.start_at instanceof Date ? row.start_at.toISOString() : String(row.start_at),
    endAt: row.end_at instanceof Date ? row.end_at.toISOString() : String(row.end_at),
    status: row.status,
    meetUrl: row.meet_url,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
  }
}
