import { db } from '@/config/db'
import { MISSING_MEETING, type MeetingFacts } from '@/lib/automations/appointments'

/**
 * The engine's read of a meeting — the appointment occurrence's live state.
 *
 * Read-only and agency-scoped, matching the rest of `db/automations/*`: the
 * engine never writes to the Meetings domain, and a job for one agency can
 * never observe another's meeting. The agency filter is part of the WHERE
 * clause rather than a check afterwards, so a mismatched id returns "missing"
 * instead of leaking existence.
 *
 * A missing row is a normal answer. The meeting may have been deleted between
 * booking and reminder, and `MISSING_MEETING` is what tells the guard to skip.
 */

type Row = {
  status: string | null
  start_at: Date | string | null
  end_at: Date | string | null
  title: string | null
  location: string | null
  meet_url: string | null
  timezone: string | null
}

const asDate = (v: Date | string | null): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function getMeetingFactsQuery(agencyId: number, meetingId: number) {
  return db('meetings')
    .select('status', 'start_at', 'end_at', 'title', 'location', 'meet_url', 'timezone')
    .where({ id: meetingId, agency_id: agencyId })
    .first()
}

export async function getMeetingFacts(agencyId: number, meetingId: number): Promise<MeetingFacts> {
  const row = (await getMeetingFactsQuery(agencyId, meetingId)) as Row | undefined
  if (!row) return MISSING_MEETING
  return {
    exists: true,
    status: row.status ?? null,
    startsAt: asDate(row.start_at),
    endsAt: asDate(row.end_at),
    title: row.title ?? null,
    location: row.location ?? null,
    meetUrl: row.meet_url ?? null,
    timezone: row.timezone ?? null,
  }
}
