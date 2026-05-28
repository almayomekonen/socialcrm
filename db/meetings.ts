import { db } from '@/config/db'

export type MeetingStatus = 'scheduled' | 'cancelled' | 'completed'
export type MeetingSyncStatus = 'pending' | 'synced' | 'failed' | 'reauth_required'

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
  sync_status: MeetingSyncStatus
  sync_attempts: number
  sync_error: string | null
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

export async function listMeetingsForLead(input: {
  leadId: number
  agencyId: number
}): Promise<MeetingRow[]> {
  const rows = await db('meetings')
    .where({ lead_id: input.leadId, agency_id: input.agencyId })
    .orderBy('start_at', 'desc')
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
  const rows = await db('meetings')
    .where({
      agency_id: input.agencyId,
      organizer_user_id: input.organizerUserId,
      status: 'scheduled',
    })
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

/**
 * Outcome of pushing the meeting to Google. The action layer picks one
 * shape based on what calendarClient returned (or threw); this helper
 * keeps the column-level details in one place.
 *
 *   synced            → record provider ids, clear error, reset attempts
 *   failed | reauth_*  → store error code, bump sync_attempts so a future
 *                        Phase 1.5 cron sweep can cap retries
 */
export type MeetingSyncUpdate =
  | {
      status: 'synced'
      googleEventId: string
      googleIcalUid: string
      meetUrl: string | null
    }
  | { status: 'reauth_required'; syncError: string }
  | { status: 'failed'; syncError: string }

export async function updateMeetingSyncState(
  id: number,
  patch: MeetingSyncUpdate,
): Promise<void> {
  if (patch.status === 'synced') {
    await db('meetings').where({ id }).update({
      sync_status: 'synced',
      sync_error: null,
      // Reset the failure streak — a future failure starts the count over.
      sync_attempts: 0,
      google_event_id: patch.googleEventId,
      google_ical_uid: patch.googleIcalUid,
      meet_url: patch.meetUrl,
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
