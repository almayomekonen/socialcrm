import 'server-only'
import { db } from '@/config/db'
import { businessInstantMs, formatBusinessTime } from '@/lib/today/time'

/**
 * Availability, from the ONE source this system can actually read: the
 * organizer's own scheduled SocialCRM meetings. Google free/busy is NOT read
 * (the calendar connection holds `calendar.events` only), so every message
 * built from this says "SocialCRM", never "your calendar".
 */

const SLOT_MIN = 30
const DAY_START = '08:00'
const DAY_END = '20:00'

export type Conflict = { startAt: Date; endAt: Date }

export async function findMeetingConflicts(input: { agencyId: number; organizerUserId: number; startAt: Date; endAt: Date; excludeMeetingId?: number }): Promise<Conflict[]> {
  const rows = (await db('meetings')
    .where({ agency_id: input.agencyId, organizer_user_id: input.organizerUserId, status: 'scheduled' })
    .where('start_at', '<', input.endAt)
    .where('end_at', '>', input.startAt)
    .modify((q) => (input.excludeMeetingId ? q.whereNot('id', input.excludeMeetingId) : q))
    .orderBy('start_at')
    .select('start_at', 'end_at')) as { start_at: Date; end_at: Date }[]
  return rows.map((r) => ({ startAt: new Date(r.start_at), endAt: new Date(r.end_at) }))
}

/** Up to `limit` free slots of the same length later that day (08:00-20:00, 30-minute steps), by SocialCRM meetings only. */
export async function suggestFreeSlots(input: {
  agencyId: number
  organizerUserId: number
  date: string
  afterMs: number
  durationMinutes: number
  nowMs: number
  limit?: number
  /** A meeting being moved does not block its own later slots. */
  excludeMeetingId?: number
}): Promise<string[]> {
  const dayStart = businessInstantMs(input.date, DAY_START)
  const dayEnd = businessInstantMs(input.date, DAY_END)
  const durMs = input.durationMinutes * 60_000
  const busy = await findMeetingConflicts({ agencyId: input.agencyId, organizerUserId: input.organizerUserId, excludeMeetingId: input.excludeMeetingId, startAt: new Date(dayStart), endAt: new Date(dayEnd) })
  const slotMs = SLOT_MIN * 60_000
  const first = dayStart + Math.ceil(Math.max(0, input.afterMs - dayStart) / slotMs) * slotMs
  const out: string[] = []
  for (let t = first; t + durMs <= dayEnd && out.length < (input.limit ?? 2); t += slotMs) {
    if (t <= input.nowMs) continue
    const clash = busy.some((b) => b.startAt.getTime() < t + durMs && b.endAt.getTime() > t)
    if (!clash) out.push(formatBusinessTime(t))
  }
  return out
}
