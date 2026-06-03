import { db } from '@/config/db'

export type MeetingStatus = 'scheduled' | 'cancelled' | 'completed' | 'no_show'
export type MeetingSyncStatus = 'pending' | 'synced' | 'failed' | 'reauth_required'

export type ReminderOverride = { method: 'email' | 'popup'; minutes: number }

export type MeetingRow = {
  id: number
  agency_id: number
  organizer_user_id: number
  lead_id: number | null
  title: string
  description: string | null
  location: string | null
  timezone: string
  start_at: Date
  end_at: Date
  status: MeetingStatus
  meet_url: string | null
  google_event_id: string | null
  google_ical_uid: string | null
  etag: string | null
  sync_status: MeetingSyncStatus
  sync_attempts: number
  sync_error: string | null
  internal_notes: string | null
  reminder_overrides: ReminderOverride[] | null
  completed_at: Date | null
  no_show_at: Date | null
  last_refreshed_at: Date | null
  created_at: Date
  updated_at: Date
}

export async function insertMeeting(input: {
  agencyId: number
  organizerUserId: number
  leadId: number | null
  title: string
  description: string | null
  location: string | null
  timezone: string
  startAt: Date
  endAt: Date
}): Promise<number> {
  const [row] = await db('meetings')
    .insert({
      agency_id: input.agencyId,
      organizer_user_id: input.organizerUserId,
      lead_id: input.leadId,
      title: input.title,
      description: input.description,
      location: input.location,
      timezone: input.timezone,
      start_at: input.startAt,
      end_at: input.endAt,
      status: 'scheduled',
      sync_status: 'pending',
      sync_attempts: 0,
    })
    .returning('id')
  return (row as { id: number }).id
}

export async function getMeeting(id: number, agencyId: number): Promise<MeetingRow | null> {
  const row = await db('meetings').where({ id, agency_id: agencyId }).first()
  return (row ?? null) as MeetingRow | null
}

export async function listMeetingsForLead(input: { leadId: number; agencyId: number }): Promise<MeetingRow[]> {
  const rows = await db('meetings').where({ lead_id: input.leadId, agency_id: input.agencyId }).orderBy('start_at', 'desc')
  return rows as MeetingRow[]
}

export async function listUpcomingMeetings(input: {
  agencyId: number
  organizerUserId: number
  limit?: number
  fromAt?: Date
}): Promise<MeetingRow[]> {
  const from = input.fromAt ?? new Date()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  // Includes terminal-outcome meetings (completed / no_show) so the calendar
  // grid shows yesterday's-and-today's outcomes alongside upcoming work.
  // Cancelled meetings stay hidden — Google already sent the cancellation,
  // showing them on the grid would only confuse the rep.
  const rows = await db('meetings')
    .where({
      agency_id: input.agencyId,
      organizer_user_id: input.organizerUserId,
    })
    .whereIn('status', ['scheduled', 'completed', 'no_show'])
    .where('start_at', '>=', from)
    .orderBy('start_at', 'asc')
    .limit(limit)
  return rows as MeetingRow[]
}

export async function markMeetingCancelled(id: number, agencyId: number): Promise<void> {
  await db('meetings').where({ id, agency_id: agencyId }).update({
    status: 'cancelled',
    updated_at: new Date(),
  })
}

export async function markMeetingCompleted(id: number, agencyId: number): Promise<void> {
  await db('meetings').where({ id, agency_id: agencyId }).update({
    status: 'completed',
    completed_at: new Date(),
    updated_at: new Date(),
  })
}

export async function markMeetingNoShow(id: number, agencyId: number): Promise<void> {
  await db('meetings').where({ id, agency_id: agencyId }).update({
    status: 'no_show',
    no_show_at: new Date(),
    updated_at: new Date(),
  })
}

/**
 * Outcome of an events.insert push to Google. The action layer picks one
 * shape based on what calendarClient returned (or threw).
 *
 *   synced            → record provider ids + etag, clear error, reset
 *                       sync_attempts. Captures `etag` so the first
 *                       events.patch can use If-Match.
 *   failed | reauth_*  → store error code, bump sync_attempts so a future
 *                        retry sweep can cap retries. Never touches
 *                        google_event_id / etag — retries depend on them.
 */
export type MeetingSyncUpdate =
  | {
      status: 'synced'
      googleEventId: string
      googleIcalUid: string
      meetUrl: string | null
      etag: string | null
    }
  | { status: 'reauth_required'; syncError: string }
  | { status: 'failed'; syncError: string }

export async function updateMeetingSyncState(id: number, patch: MeetingSyncUpdate): Promise<void> {
  if (patch.status === 'synced') {
    await db('meetings').where({ id }).update({
      sync_status: 'synced',
      sync_error: null,
      sync_attempts: 0,
      google_event_id: patch.googleEventId,
      google_ical_uid: patch.googleIcalUid,
      meet_url: patch.meetUrl,
      etag: patch.etag,
      updated_at: new Date(),
    })
    return
  }
  await db('meetings')
    .where({ id })
    .update({
      sync_status: patch.status,
      sync_error: patch.syncError.slice(0, 1000),
      sync_attempts: db.raw('sync_attempts + 1'),
      updated_at: new Date(),
    })
}

/**
 * Apply a successful events.patch outcome: refresh etag, clear sync errors,
 * reset the failure streak. Leaves google_event_id / google_ical_uid /
 * meet_url alone — those identifiers don't change across a patch (Meet
 * room is preserved unless conferenceData is sent, which updateEvent never
 * does).
 */
export async function markMeetingPatched(id: number, agencyId: number, etag: string): Promise<void> {
  await db('meetings').where({ id, agency_id: agencyId }).update({
    sync_status: 'synced',
    sync_error: null,
    sync_attempts: 0,
    etag,
    updated_at: new Date(),
  })
}

export type MeetingMutablePatch = {
  title?: string
  description?: string | null
  location?: string | null
  internalNotes?: string | null
  timezone?: string
  startAt?: Date
  endAt?: Date
  reminderOverrides?: ReminderOverride[] | null
}

export async function updateMeetingMutableFields(id: number, agencyId: number, patch: MeetingMutablePatch): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.description !== undefined) row.description = patch.description
  if (patch.location !== undefined) row.location = patch.location
  if (patch.internalNotes !== undefined) row.internal_notes = patch.internalNotes
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.startAt !== undefined) row.start_at = patch.startAt
  if (patch.endAt !== undefined) row.end_at = patch.endAt
  if (patch.reminderOverrides !== undefined) {
    // Postgres jsonb: null passes through; arrays must be stringified for knex.
    row.reminder_overrides = patch.reminderOverrides === null ? null : JSON.stringify(patch.reminderOverrides)
  }
  // No-op if nothing to write — don't bump updated_at on an empty call.
  if (Object.keys(row).length === 0) return
  row.updated_at = new Date()
  await db('meetings').where({ id, agency_id: agencyId }).update(row)
}
