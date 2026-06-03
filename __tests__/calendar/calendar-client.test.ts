/**
 * Calendar — Google Calendar HTTP client tests.
 *
 * Direct unit coverage of updateEvent (Task 2's new transport function).
 * Mocks the OAuth token fetch (so we don't need calendarTokens) and the
 * global fetch (so we don't hit Google). Pins:
 *
 *   - PATCH URL composition (calendarId, eventId, sendUpdates, conferenceDataVersion)
 *   - Sparse body construction (only provided keys are included)
 *   - null vs undefined semantics (null = clear, undefined = leave-as-is)
 *   - If-Match header iff etag is non-null
 *   - Meet preservation: conferenceData NEVER in patch body
 *   - 412 → CalendarApiError('etag_mismatch')
 *   - 5xx → CalendarApiError('server_error')
 *   - 401 → CalendarApiError('reauth_required')
 *   - timezone-required validation (start/end without timezone throws)
 *
 * Run with VITEST_NO_DB=1.
 */

import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))

vi.mock('@/lib/integrations/google/calendarTokens', () => ({
  getValidCalendarAccessToken: vi.fn(async () => 'test-access-token'),
  CalendarAuthError: class CalendarAuthError extends Error {
    constructor(public reason: string) {
      super(reason)
    }
  },
}))

// We do NOT mock @/db/googleCalendarConnections; the diag-only import in
// calendarClient.ts only fires when CALENDAR_INVITE_DIAG=1, which we leave off.
// Provide an empty module to short-circuit it just in case.
vi.mock('@/db/googleCalendarConnections', () => ({
  getCalendarConnectionByUserId: vi.fn(),
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { updateEvent, CalendarApiError } from '@/lib/integrations/google/calendarClient'

// ─── Fetch helpers ───────────────────────────────────────────────────────────

type FetchCapture = {
  url: string
  init: RequestInit
}

let lastRequest: FetchCapture | null = null

function mockFetchResponse(opts: { status: number; body?: unknown; headers?: HeadersInit }) {
  const headers = new Headers(opts.headers ?? {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      lastRequest = { url, init }
      return {
        ok: opts.status >= 200 && opts.status < 300,
        status: opts.status,
        headers,
        json: async () => opts.body ?? {},
        text: async () =>
          typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {}),
        clone() {
          return this
        },
      } as unknown as Response
    }),
  )
}

function getRequestBody(): Record<string, unknown> {
  if (!lastRequest?.init.body) return {}
  return JSON.parse(String(lastRequest.init.body)) as Record<string, unknown>
}

function getRequestHeader(name: string): string | undefined {
  const h = lastRequest?.init.headers as Record<string, string> | undefined
  if (!h) return undefined
  // Headers may be stored case-sensitively in Record form.
  const found = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase())
  return found ? h[found] : undefined
}

const SUCCESS_RESPONSE = {
  id: 'gid-100',
  etag: '"new-etag"',
  iCalUID: 'ical-xyz',
  start: { dateTime: '2026-06-01T10:00:00.000Z', timeZone: 'Asia/Jerusalem' },
  end: { dateTime: '2026-06-01T11:00:00.000Z', timeZone: 'Asia/Jerusalem' },
  attendees: [
    { email: 'a@x.com', responseStatus: 'needsAction' as const },
    { email: 'b@x.com', responseStatus: 'accepted' as const },
  ],
  // Crucially absent: conferenceData. updateEvent must not send it OR rely on it.
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('updateEvent (Google Calendar PATCH transport)', () => {
  beforeEach(() => {
    lastRequest = null
    vi.unstubAllGlobals()
  })

  // ── URL composition ────────────────────────────────────────────────────────

  it("PATCHes to /calendars/primary/events/{id} with sendUpdates+conferenceDataVersion params", async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 'New title',
    })

    expect(lastRequest?.init.method).toBe('PATCH')
    expect(lastRequest?.url).toContain(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/gid-100',
    )
    // Defaults: sendUpdates=all, conferenceDataVersion=1.
    expect(lastRequest?.url).toContain('sendUpdates=all')
    expect(lastRequest?.url).toContain('conferenceDataVersion=1')
  })

  it("uses provided calendarId when not 'primary'", async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      calendarId: 'custom@calendar.com',
      title: 'x',
    })
    expect(lastRequest?.url).toContain(encodeURIComponent('custom@calendar.com'))
  })

  it("forwards sendUpdates='externalOnly' when caller sets it", async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 'x',
      sendUpdates: 'externalOnly',
    })
    expect(lastRequest?.url).toContain('sendUpdates=externalOnly')
  })

  // ── Sparse body construction ───────────────────────────────────────────────

  it('omits keys the caller did not pass (only title sent → only summary in body)', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'Just title' })

    const body = getRequestBody()
    expect(body).toEqual({ summary: 'Just title' })
    expect(body).not.toHaveProperty('description')
    expect(body).not.toHaveProperty('location')
    expect(body).not.toHaveProperty('start')
    expect(body).not.toHaveProperty('end')
    expect(body).not.toHaveProperty('attendees')
  })

  it("null in description/location clears the field (sent as null in body)", async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      description: null,
      location: null,
    })

    const body = getRequestBody()
    expect(body.description).toBeNull()
    expect(body.location).toBeNull()
    // title not provided → omitted.
    expect(body).not.toHaveProperty('summary')
  })

  it('start/end + timezone produce structured start/end objects', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    const start = new Date('2026-06-01T13:00:00.000Z')
    const end = new Date('2026-06-01T14:00:00.000Z')

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      startAt: start,
      endAt: end,
      timezone: 'Europe/Berlin',
    })

    const body = getRequestBody()
    expect(body.start).toEqual({
      dateTime: start.toISOString(),
      timeZone: 'Europe/Berlin',
    })
    expect(body.end).toEqual({
      dateTime: end.toISOString(),
      timeZone: 'Europe/Berlin',
    })
  })

  it('attendees array maps to {email, displayName} entries', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      attendees: [
        { email: 'a@x.com', displayName: 'Alice' },
        { email: 'b@x.com' },
      ],
    })

    const body = getRequestBody()
    expect(body.attendees).toEqual([
      { email: 'a@x.com', displayName: 'Alice' },
      { email: 'b@x.com' }, // displayName undefined → JSON.stringify drops the key
    ])
  })

  it('empty attendees array IS sent (Google reads this as "clear all")', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({ userId: 1, googleEventId: 'gid-100', attendees: [] })

    const body = getRequestBody()
    // Distinct from undefined — empty array must be present.
    expect(body).toHaveProperty('attendees')
    expect(body.attendees).toEqual([])
  })

  // ── Meet preservation ─────────────────────────────────────────────────────

  it('NEVER sends conferenceData in the patch body (preserves the Meet room)', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 't',
      description: 'd',
      location: 'l',
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T11:00:00Z'),
      timezone: 'Asia/Jerusalem',
      attendees: [{ email: 'x@y.com' }],
    })

    const body = getRequestBody()
    expect(body).not.toHaveProperty('conferenceData')
  })

  // ── If-Match header ───────────────────────────────────────────────────────

  it('sends If-Match header when etag is provided', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      etag: '"abc123"',
      title: 'x',
    })

    expect(getRequestHeader('If-Match')).toBe('"abc123"')
  })

  it('omits If-Match header when etag is null (Phase 1 suspension path)', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      etag: null,
      title: 'x',
    })

    expect(getRequestHeader('If-Match')).toBeUndefined()
  })

  it('omits If-Match header when etag is undefined', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    await updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' })

    expect(getRequestHeader('If-Match')).toBeUndefined()
  })

  // ── Authorization header ──────────────────────────────────────────────────

  it('attaches Bearer token from getValidCalendarAccessToken', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })
    await updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' })
    expect(getRequestHeader('Authorization')).toBe('Bearer test-access-token')
  })

  // ── Validation ────────────────────────────────────────────────────────────

  it('throws CalendarApiError(invalid_request) when startAt is set without timezone', async () => {
    await expect(
      updateEvent({
        userId: 1,
        googleEventId: 'gid-100',
        startAt: new Date('2026-06-01T10:00:00Z'),
      }),
    ).rejects.toMatchObject({
      name: 'CalendarApiError',
      reason: 'invalid_request',
      status: 400,
    })
  })

  it('throws CalendarApiError(invalid_request) when endAt is set without timezone', async () => {
    await expect(
      updateEvent({
        userId: 1,
        googleEventId: 'gid-100',
        endAt: new Date('2026-06-01T11:00:00Z'),
      }),
    ).rejects.toMatchObject({
      name: 'CalendarApiError',
      reason: 'invalid_request',
      status: 400,
    })
  })

  // ── Error mapping ─────────────────────────────────────────────────────────

  it('maps 412 to CalendarApiError(etag_mismatch)', async () => {
    mockFetchResponse({ status: 412, body: 'precondition failed' })

    await expect(
      updateEvent({
        userId: 1,
        googleEventId: 'gid-100',
        etag: '"stale"',
        title: 'x',
      }),
    ).rejects.toMatchObject({
      name: 'CalendarApiError',
      reason: 'etag_mismatch',
      status: 412,
    })
  })

  it('maps 401 to CalendarApiError(reauth_required)', async () => {
    mockFetchResponse({ status: 401, body: 'unauthorized' })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'reauth_required', status: 401 })
  })

  it('maps 404 to CalendarApiError(not_found)', async () => {
    mockFetchResponse({ status: 404, body: 'not found' })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'deleted-event', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'not_found', status: 404 })
  })

  it('maps 500 to CalendarApiError(server_error)', async () => {
    mockFetchResponse({ status: 500, body: 'oops' })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'server_error', status: 500 })
  })

  it('maps 429 to CalendarApiError(rate_limited)', async () => {
    mockFetchResponse({ status: 429, body: 'rate limited' })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'rate_limited', status: 429 })
  })

  it('maps 403 insufficientPermissions to CalendarApiError(missing_scope)', async () => {
    mockFetchResponse({
      status: 403,
      body: '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}',
    })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'missing_scope', status: 403 })
  })

  it('maps generic 403 to CalendarApiError(forbidden)', async () => {
    mockFetchResponse({ status: 403, body: 'forbidden domain policy' })
    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'forbidden', status: 403 })
  })

  // ── Response parsing ──────────────────────────────────────────────────────

  it('returns googleEventId, etag, start/end, meetLink, and filtered attendees', async () => {
    mockFetchResponse({ status: 200, body: SUCCESS_RESPONSE })

    const result = await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 'x',
    })

    expect(result.googleEventId).toBe('gid-100')
    expect(result.etag).toBe('"new-etag"')
    expect(result.startAt).toBe('2026-06-01T10:00:00.000Z')
    expect(result.endAt).toBe('2026-06-01T11:00:00.000Z')
    // No conferenceData in response → null meetLink (we don't send conferenceData
    // on a patch so the response often omits it).
    expect(result.meetLink).toBeNull()
    expect(result.attendees).toEqual([
      { email: 'a@x.com', responseStatus: 'needsAction' },
      { email: 'b@x.com', responseStatus: 'accepted' },
    ])
  })

  it('throws unknown on malformed success response (missing required fields)', async () => {
    mockFetchResponse({
      status: 200,
      body: { id: 'g', etag: '"e"' }, // start/end missing
    })

    await expect(
      updateEvent({ userId: 1, googleEventId: 'gid-100', title: 'x' }),
    ).rejects.toMatchObject({ reason: 'unknown' })
  })

  it('filters out attendees lacking email or responseStatus in response', async () => {
    mockFetchResponse({
      status: 200,
      body: {
        ...SUCCESS_RESPONSE,
        attendees: [
          { email: 'ok@x.com', responseStatus: 'accepted' },
          { email: 'no-status@x.com' }, // missing responseStatus → dropped
          { responseStatus: 'declined' }, // missing email → dropped
        ],
      },
    })

    const result = await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 'x',
    })

    expect(result.attendees).toEqual([{ email: 'ok@x.com', responseStatus: 'accepted' }])
  })

  it('extracts meetLink from conferenceData.entryPoints when present in response', async () => {
    mockFetchResponse({
      status: 200,
      body: {
        ...SUCCESS_RESPONSE,
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1234' },
            {
              entryPointType: 'video',
              uri: 'https://meet.google.com/abc-def-ghi',
            },
          ],
        },
      },
    })

    const result = await updateEvent({
      userId: 1,
      googleEventId: 'gid-100',
      title: 'x',
    })

    expect(result.meetLink).toBe('https://meet.google.com/abc-def-ghi')
  })
})
