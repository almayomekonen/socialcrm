import { getValidCalendarAccessToken } from './calendarTokens'
import { buildMeetConferenceData, extractMeetUrl, type GoogleEventConferenceData } from './calendarMeetBuilder'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'

const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

// === TEMP DIAG (Phase 1 invitation delivery) ===
const INVITE_DIAG = process.env.CALENDAR_INVITE_DIAG === '1'

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
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export type CreateEventResult = {
  googleEventId: string
  meetLink: string | null
  googleIcalUid: string
  etag: string
}

export type UpdateEventInput = {
  userId: number
  googleEventId: string
  calendarId?: string
  etag?: string | null
  title?: string
  description?: string | null
  location?: string | null
  startAt?: Date
  endAt?: Date
  timezone?: string
  attendees?: Array<{ email: string; displayName?: string | null }>
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export type UpdateEventResult = {
  googleEventId: string
  etag: string
  meetLink: string | null
  startAt: string
  endAt: string
  attendees: Array<{
    email: string
    responseStatus: 'needsAction' | 'accepted' | 'declined' | 'tentative'
  }>
}

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
      | 'etag_mismatch'
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

  if (INVITE_DIAG) {
    let organizerEmail: string | null = null
    try {
      const conn = await getCalendarConnectionByUserId(input.userId)
      organizerEmail = conn?.google_email ?? null
    } catch {
      organizerEmail = null
    }
    console.info('[calendar.invite.diag] request', {
      meetingId: input.meetingId,
      userId: input.userId,
      organizerEmail,
      calendarId,
      requestUrl: url,
      sendUpdates,
      conferenceDataVersion: '1',
      requestMeet,
      attendeeCount: input.attendees?.length ?? 0,
      attendeesArray: input.attendees,
      attendeeEmails: input.attendees?.map((a) => a.email) ?? [],
      requestBody: body,
    })
  }
  // === /TEMP DIAG ===

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  // === TEMP DIAG (Phase 1 invitation delivery) ===
  // Capture the raw error body BEFORE mapErrorResponse consumes the stream.
  // Google's error payload often includes domain/reason fields that pin down
  // policy-vs-quota-vs-scope failures.
  if (INVITE_DIAG && !res.ok) {
    const errBody = await res
      .clone()
      .text()
      .catch(() => '<unreadable>')
    console.info('[calendar.invite.diag] error_response', {
      meetingId: input.meetingId,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: errBody.slice(0, 2000),
    })
  }
  // === /TEMP DIAG ===

  if (!res.ok) throw await mapErrorResponse(res, 'calendar.createEvent')

  const event = (await res.json()) as {
    id?: string
    iCalUID?: string
    etag?: string
    htmlLink?: string
    status?: string
    organizer?: { email?: string; displayName?: string; self?: boolean }
    creator?: { email?: string; displayName?: string; self?: boolean }
    attendees?: Array<{
      email?: string
      displayName?: string
      responseStatus?: 'needsAction' | 'accepted' | 'declined' | 'tentative'
      organizer?: boolean
      self?: boolean
      resource?: boolean
      optional?: boolean
    }>
    conferenceData?: GoogleEventConferenceData
  }

  if (!event.id || !event.iCalUID || !event.etag) {
    throw new CalendarApiError(
      'unknown',
      res.status,
      `calendar.createEvent: malformed response (id=${event.id}, iCalUID=${event.iCalUID}, etag=${event.etag})`,
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

  // === TEMP DIAG (Phase 1 invitation delivery) ===
  // Full success-response dump. The five fields that pin down each failure
  // mode (see Task 1 doc): attendees[*].responseStatus, organizer.email,
  // conferenceData.createRequest.status.statusCode, event.id, event.htmlLink.
  if (INVITE_DIAG) {
    console.info('[calendar.invite.diag] success_response', {
      meetingId: input.meetingId,
      status: res.status,
      googleEventId: event.id,
      iCalUID: event.iCalUID,
      etag: event.etag,
      htmlLink: event.htmlLink,
      eventStatus: event.status,
      organizer: event.organizer,
      creator: event.creator,
      attendees: event.attendees,
      attendeeResponseStatuses: event.attendees?.map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
      conferenceDataStatus: event.conferenceData?.createRequest?.status?.statusCode,
      conferenceEntryPoints: event.conferenceData?.entryPoints,
    })
  }
  // === /TEMP DIAG ===

  return {
    googleEventId: event.id,
    meetLink,
    googleIcalUid: event.iCalUID,
    etag: event.etag,
  }
}

/**
 * Update an existing Google Calendar event via events.patch.
 *
 *   - Only fields present in `input` are sent in the PATCH body. `undefined`
 *     leaves the field unchanged; explicit `null` clears it (per Google's
 *     PATCH semantics for nullable fields).
 *   - When `input.attendees` is provided, the attendee list is REPLACED in
 *     Google. When undefined, the list is left as-is. Callers that want
 *     Google to leave attendees alone must NOT include the key.
 *   - `conferenceData` is NEVER sent — this preserves the existing Google
 *     Meet room. Sending conferenceData on a patch would trigger creation of
 *     a new Meet room and orphan the old one.
 *   - When `input.etag` is provided, sent as If-Match. 412 → CalendarApiError
 *     with reason='etag_mismatch'. When omitted, the patch is unconditional
 *     (last-write-wins) — acceptable for rows synced before etag tracking.
 *   - `sendUpdates` defaults to 'all'. Callers (e.g. drag handlers) can
 *     downshift to 'externalOnly' to avoid attendee spam on minor reschedules.
 */
export async function updateEvent(input: UpdateEventInput): Promise<UpdateEventResult> {
  // Validate inputs that depend on each other before touching the network.
  if ((input.startAt !== undefined || input.endAt !== undefined) && !input.timezone) {
    throw new CalendarApiError(
      'invalid_request',
      400,
      'calendar.updateEvent: timezone is required when startAt or endAt is provided',
    )
  }

  const token = await getValidCalendarAccessToken(input.userId)
  const calendarId = encodeURIComponent(input.calendarId ?? 'primary')
  const eventId = encodeURIComponent(input.googleEventId)
  const sendUpdates = input.sendUpdates ?? 'all'

  // Build a sparse body: include only the keys the caller provided. Google
  // patches by replacing each top-level field that appears in the body.
  const body: Record<string, unknown> = {}
  if (input.title !== undefined) body.summary = input.title
  if (input.description !== undefined) body.description = input.description
  if (input.location !== undefined) body.location = input.location
  if (input.startAt !== undefined) {
    body.start = { dateTime: input.startAt.toISOString(), timeZone: input.timezone }
  }
  if (input.endAt !== undefined) {
    body.end = { dateTime: input.endAt.toISOString(), timeZone: input.timezone }
  }
  if (input.attendees !== undefined) {
    body.attendees = input.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName ?? undefined,
    }))
  }
  // conferenceData intentionally omitted — preserves the existing Meet room.

  const params = new URLSearchParams({
    sendUpdates,
    // Required when modifying conferenceData; harmless otherwise. Set
    // unconditionally to match createEvent's convention.
    conferenceDataVersion: '1',
  })

  const url = `${EVENTS_BASE}/${calendarId}/events/${eventId}?${params.toString()}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (input.etag) headers['If-Match'] = input.etag

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] calendar.patch.request', {
      googleEventId: input.googleEventId,
      calendarId,
      sendUpdates,
      hasEtag: !!input.etag,
      patchKeys: Object.keys(body),
      attendeeCount: input.attendees?.length,
    })
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) throw await mapErrorResponse(res, 'calendar.updateEvent')

  const event = (await res.json()) as {
    id?: string
    etag?: string
    start?: { dateTime?: string }
    end?: { dateTime?: string }
    attendees?: Array<{
      email?: string
      responseStatus?: 'needsAction' | 'accepted' | 'declined' | 'tentative'
    }>
    conferenceData?: GoogleEventConferenceData
  }

  if (!event.id || !event.etag || !event.start?.dateTime || !event.end?.dateTime) {
    throw new CalendarApiError(
      'unknown',
      res.status,
      `calendar.updateEvent: malformed response (id=${event.id}, etag=${event.etag})`,
    )
  }

  // Filter out attendees missing email (defensive — Google may omit emails
  // for resource-type attendees). Drop ones without a responseStatus.
  const attendees: UpdateEventResult['attendees'] = (event.attendees ?? [])
    .filter(
      (a): a is { email: string; responseStatus: NonNullable<typeof a.responseStatus> } =>
        typeof a.email === 'string' && a.responseStatus != null,
    )
    .map((a) => ({ email: a.email, responseStatus: a.responseStatus }))

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] calendar.patch.response', {
      googleEventId: event.id,
      etag: event.etag,
      attendeeCount: attendees.length,
    })
  }

  return {
    googleEventId: event.id,
    etag: event.etag,
    meetLink: extractMeetUrl(event.conferenceData),
    startAt: event.start.dateTime,
    endAt: event.end.dateTime,
    attendees,
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
  // 412 Precondition Failed = If-Match etag did not match — another writer
  // changed the event since we last fetched. Only emitted by updateEvent.
  if (res.status === 412) return new CalendarApiError('etag_mismatch', res.status, message)
  if (res.status === 429) return new CalendarApiError('rate_limited', res.status, message)
  if (res.status >= 500 && res.status < 600) {
    return new CalendarApiError('server_error', res.status, message)
  }
  if (res.status === 400) return new CalendarApiError('invalid_request', res.status, message)

  return new CalendarApiError('unknown', res.status, message)
}
