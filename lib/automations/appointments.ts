import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * The appointment occurrence — identity, facts, and the one invariant a
 * reminder must satisfy before it is allowed to send.
 *
 * WHY THIS FILE EXISTS. `appointment_booked` names an OCCURRENCE, not an
 * integration (the connections-store migration says so explicitly). The
 * Meetings domain is now the source of that occurrence: the meeting already
 * lives in the CRM, the lead is already resolved on it, and no calendar
 * provider is in the path. Nothing here talks to Google or to any scheduling
 * product.
 *
 * The occurrence key is the ONLY channel through which the meeting's identity
 * reaches the worker — `automation_jobs` carries `eventKey` and no payload. So
 * the format is owned here, in one place, with a parser beside the builder,
 * rather than being assembled at the emit site and re-derived by hand later.
 */

const PREFIX = 'appointment:meeting:'

/** Stable, deduplicating occurrence identity for one meeting. */
export const occurrenceKeyForMeeting = (meetingId: number): string => `${PREFIX}${meetingId}`

/**
 * The meeting id an occurrence key refers to, or null when the key belongs to
 * some other appointment source. Null is a normal answer, never an error: a
 * key this module did not write is simply not a meeting.
 */
export function meetingIdFromOccurrenceKey(eventKey: string | null | undefined): number | null {
  if (!eventKey || !eventKey.startsWith(PREFIX)) return null
  const parsed = Number(eventKey.slice(PREFIX.length))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** Everything the engine needs to know about a meeting at send time. */
export type MeetingFacts = {
  exists: boolean
  /** 'scheduled' | 'cancelled' | 'completed' | 'no_show' */
  status: string | null
  startsAt: Date | null
  endsAt: Date | null
  title: string | null
  location: string | null
  meetUrl: string | null
  timezone: string | null
}

export const MISSING_MEETING: MeetingFacts = {
  exists: false,
  status: null,
  startsAt: null,
  endsAt: null,
  title: null,
  location: null,
  meetUrl: null,
  timezone: null,
}

/** Why a reminder must not be sent. Null means it may. */
export type AppointmentBlock = 'meeting_missing' | 'meeting_cancelled' | 'meeting_passed'

/**
 * The reminder invariant — pure, so it is testable without a database.
 *
 * These three checks are ENGINE-LEVEL, not customer conditions. A reminder that
 * fires for a deleted meeting, a cancelled meeting, or a meeting that has
 * already started is wrong in a way the customer cannot be asked to prevent,
 * so it must not be expressible as a condition they could remove.
 *
 * `meeting_passed` is the one that earns its keep: the send is scheduled for a
 * moment before the meeting, so under normal operation the meeting is still
 * ahead by construction. It stops being true when the job is late — a worker
 * outage, an exhausted lease, a retry chain — which is exactly when a "your
 * meeting is in an hour" email would be at its most embarrassing.
 */
export function appointmentBlock(facts: MeetingFacts, now: Date): AppointmentBlock | null {
  if (!facts.exists) return 'meeting_missing'
  if (facts.status === 'cancelled') return 'meeting_cancelled'
  if (!facts.startsAt || facts.startsAt.getTime() <= now.getTime()) return 'meeting_passed'
  return null
}

/**
 * The meeting's moment, in Hebrew, in the BUSINESS timezone.
 *
 * Formatted on the SERVER and passed down as a resolved string. A recipient's
 * device timezone is not the business's, and the meeting time is the business's
 * fact — the same reasoning `businessDay.ts` applies to "today".
 */
export function formatMeetingWhen(startsAt: Date | null, timezone?: string | null): string {
  if (!startsAt || Number.isNaN(startsAt.getTime())) return ''
  const tz = timezone?.trim() || BUSINESS_TZ
  try {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(startsAt)
  } catch {
    // An unusable stored timezone must not cost the customer their reminder.
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TZ,
    }).format(startsAt)
  }
}

/**
 * The details block, as one resolved multi-line string.
 *
 * Built here rather than assembled from separate tokens in the template so that
 * ABSENT VALUES LEAVE NO TRACE. A template line reading "מקום: {{...}}" with an
 * empty location renders a dangling label; a block that simply omits the line
 * cannot. Location and the Meet link are both optional in the data, so both are
 * omitted rather than blanked.
 */
export function formatMeetingDetails(facts: MeetingFacts): string {
  const lines: string[] = []
  if (facts.title?.trim()) lines.push(facts.title.trim())
  const when = formatMeetingWhen(facts.startsAt, facts.timezone)
  if (when) lines.push(when)
  if (facts.location?.trim()) lines.push(`מקום: ${facts.location.trim()}`)
  if (facts.meetUrl?.trim()) lines.push(`קישור לפגישה: ${facts.meetUrl.trim()}`)
  return lines.join('\n')
}
