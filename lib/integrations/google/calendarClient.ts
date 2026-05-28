import { getValidCalendarAccessToken } from './calendarTokens'
import {
  buildMeetConferenceData,
  extractMeetUrl,
  type GoogleEventConferenceData,
} from './calendarMeetBuilder'

const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export type CreateEventInput = {
  userId: number
  meetingId: number
  calendarId?: string
  title: string
  description?: string | null
  location?: string | null
  startAt: Date
  endAt: Date
  timezone: string
  attendees?: Array<{ email: string; displayName?: string | null }>
  requestMeet?: boolean
  // 'all' (default): Google emails the invite to all attendees.
  // 'externalOnly': only non-domain attendees notified — Phase 2.
  // 'none': silent push — Phase 2 polish for CRM-controlled invites.
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export type CreateEventResult = {
  googleEventId: string
  meetLink: string | null
  googleIcalUid: string
}

/**
 * Discriminated API failure. The action layer maps each reason to a UI /
 * sync_status outcome:
 *   - 'reauth_required' / 'missing_scope' → flip connection, prompt reconnect
 *   - 'forbidden'                         → permanent; surface clearly
 *   - 'rate_limited' / 'server_error'     → transient; mark failed for retry
 *   - 'invalid_request'                   → bug in our payload; log + fail
 *   - 'not_found'                         → deleteEvent already handles 404
 *                                            as success, so this is only
 *                                            seen by a future getEvent path
 */
export class CalendarApiError extends Error {
  constructor(
    public reason:
      | 'reauth_required'
      | 'missing_scope'
      | 'forbidden'
      | 'rate_limited'
      | 'server_error'
      | 'invalid_request'
      | 'not_found'
      | 'unknown',
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'CalendarApiError'
  }
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const token = await getValidCalendarAccessToken(input.userId)
  const calendarId = encodeURIComponent(input.calendarId ?? 'primary')
  const requestMeet = input.requestMeet ?? true
  const sendUpdates = input.sendUpdates ?? 'all'

  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: {
      // toISOString() emits UTC with a 'Z' suffix; Google reconciles it
      // against the supplied IANA timeZone for display.
      dateTime: input.startAt.toISOString(),
      timeZone: input.timezone,
    },
    end: {
      dateTime: input.endAt.toISOString(),
      timeZone: input.timezone,
    },
  }

  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName ?? undefined,
    }))
  }

  if (requestMeet) {
    body.conferenceData = buildMeetConferenceData(input.meetingId)
  }

  const params = new URLSearchParams({
    sendUpdates,
    // Mandatory for Meet generation. Harmless when conferenceData is absent,
    // so set unconditionally.
    conferenceDataVersion: '1',
  })

  const url = `${EVENTS_BASE}/${calendarId}/events?${params.toString()}`

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] calendar.insert.request', {
      meetingId: input.meetingId,
      calendarId,
      requestMeet,
      sendUpdates,
      attendeeCount: input.attendees?.length ?? 0,
    })
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw await mapErrorResponse(res, 'calendar.createEvent')

  const event = (await res.json()) as {
    id?: string
    iCalUID?: string
    conferenceData?: GoogleEventConferenceData
  }

  if (!event.id || !event.iCalUID) {
    throw new CalendarApiError(
      'unknown',
      res.status,
      `calendar.createEvent: malformed response (id=${event.id}, iCalUID=${event.iCalUID})`,
    )
  }

  const meetLink = extractMeetUrl(event.conferenceData)

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] calendar.insert.response', {
      googleEventId: event.id,
      meetGenerated: !!meetLink,
      conferenceStatus: event.conferenceData?.createRequest?.status?.statusCode,
    })
  }

  return {
    googleEventId: event.id,
    meetLink,
    googleIcalUid: event.iCalUID,
  }
}

/**
 * Delete an event from Google. 404/410 are treated as success — the event
 * is already gone, which is the desired end state. Idempotent retries are
 * safe.
 */
export async function deleteEvent(input: {
  userId: number
  calendarId?: string
  googleEventId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}): Promise<void> {
  const token = await getValidCalendarAccessToken(input.userId)
  const calendarId = encodeURIComponent(input.calendarId ?? 'primary')
  const eventId = encodeURIComponent(input.googleEventId)
  const sendUpdates = input.sendUpdates ?? 'all'

  const url = `${EVENTS_BASE}/${calendarId}/events/${eventId}?sendUpdates=${sendUpdates}`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404 || res.status === 410) {
    if (COPILOT_TRACE) {
      console.info('[copilot.trace] calendar.delete.noop', {
        googleEventId: input.googleEventId,
        status: res.status,
      })
    }
    return
  }

  if (!res.ok) throw await mapErrorResponse(res, 'calendar.deleteEvent')
}

async function mapErrorResponse(res: Response, op: string): Promise<CalendarApiError> {
  const body = await res.text().catch(() => '')
  const snippet = body.slice(0, 300)
  const message = `${op} failed: ${res.status} ${snippet}`

  // 401 here is rare — getValidCalendarAccessToken refreshes proactively.
  // It happens when the token was valid at build time but revoked between
  // then and the call. Same UX outcome as a normal reauth_required.
  if (res.status === 401) return new CalendarApiError('reauth_required', res.status, message)

  if (res.status === 403) {
    // Body shape per https://developers.google.com/calendar/api/guides/errors
    if (body.includes('insufficientPermissions') || body.includes('insufficient_scope')) {
      return new CalendarApiError('missing_scope', res.status, message)
    }
    if (body.includes('rateLimitExceeded') || body.includes('userRateLimitExceeded')) {
      return new CalendarApiError('rate_limited', res.status, message)
    }
    return new CalendarApiError('forbidden', res.status, message)
  }

  if (res.status === 404) return new CalendarApiError('not_found', res.status, message)
  if (res.status === 429) return new CalendarApiError('rate_limited', res.status, message)
  if (res.status >= 500 && res.status < 600) {
    return new CalendarApiError('server_error', res.status, message)
  }
  if (res.status === 400) return new CalendarApiError('invalid_request', res.status, message)

  return new CalendarApiError('unknown', res.status, message)
}
