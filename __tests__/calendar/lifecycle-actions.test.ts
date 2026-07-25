/**
 * Calendar — meeting-lifecycle action tests.
 *
 * Direct coverage of createMeeting / cancelMeeting / retrySyncMeeting /
 * listUpcomingMeetings. Same DB-less mocking pattern as
 * update-meeting-action.test.ts.
 *
 * Tests are written to ASSERT CURRENT BEHAVIOR. Where current behavior
 * differs from what a careful product reading would prefer (e.g.
 * createMeeting allows past starts and zero-duration), the test is marked
 * with a `// GAP:` comment in the assertion. These are documentation, not
 * a bug — fixing them requires explicit product decision.
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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))

vi.mock('@/lib/requireUser', () => {
  const requireAgencyUser = vi.fn()
  return { requireUser: vi.fn(), requireAgencyUser, requireProductAccess: requireAgencyUser }
})

vi.mock('@/db/meetings', () => ({
  getMeeting: vi.fn(),
  insertMeeting: vi.fn(),
  listUpcomingMeetings: vi.fn(),
  markMeetingCancelled: vi.fn(),
  markMeetingPatched: vi.fn(),
  updateMeetingMutableFields: vi.fn(),
  updateMeetingSyncState: vi.fn(),
}))

vi.mock('@/db/meetingAttendees', () => ({
  getAttendeesForMeeting: vi.fn(),
  insertAttendees: vi.fn(),
  replaceAttendees: vi.fn(),
}))

vi.mock('@/db/clients', () => ({
  getFullLead: vi.fn(),
}))

vi.mock('@/lib/integrations/google/calendarClient', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/integrations/google/calendarClient')>(
      '@/lib/integrations/google/calendarClient',
    )
  return {
    ...actual,
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  }
})

import { describe, it, expect, beforeEach } from 'vitest'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  insertMeeting,
  listUpcomingMeetings as dbListUpcomingMeetings,
  markMeetingCancelled,
  updateMeetingSyncState,
  type MeetingRow,
} from '@/db/meetings'
import { getAttendeesForMeeting, insertAttendees } from '@/db/meetingAttendees'
import { getFullLead } from '@/db/clients'
import {
  createEvent,
  deleteEvent,
  CalendarApiError,
} from '@/lib/integrations/google/calendarClient'
import {
  createMeeting,
  cancelMeeting,
  retrySyncMeeting,
  listUpcomingMeetings,
} from '@/actions/calendar'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setCurrentUser(opts: { id: number; agencyId: number }) {
  vi.mocked(requireAgencyUser).mockResolvedValue({
    id: opts.id,
    agencyId: opts.agencyId,
    role: 'ADMIN',
    suspended: false,
    name: null,
    email: null,
    picture: null,
  } as any)
}

function buildMeetingRow(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 42,
    agency_id: 1,
    organizer_user_id: 100,
    lead_id: null,
    title: 'Original',
    description: null,
    location: null,
    timezone: 'Asia/Jerusalem',
    start_at: new Date('2026-07-01T10:00:00Z'),
    end_at: new Date('2026-07-01T11:00:00Z'),
    status: 'scheduled',
    meet_url: 'https://meet.example/42',
    google_event_id: 'gid-42',
    google_ical_uid: 'uid-42',
    etag: '"etag-42"',
    sync_status: 'synced',
    sync_attempts: 0,
    sync_error: null,
    internal_notes: null,
    reminder_overrides: null,
    completed_at: null,
    no_show_at: null,
    last_refreshed_at: null,
    created_at: new Date('2026-06-30T08:00:00Z'),
    updated_at: new Date('2026-06-30T08:00:00Z'),
    ...overrides,
  }
}

const validCreateInput = {
  title: 'New meeting',
  startAt: new Date('2026-07-01T13:00:00Z'),
  endAt: new Date('2026-07-01T14:00:00Z'),
  timezone: 'Asia/Jerusalem',
} as const

// ─── createMeeting ───────────────────────────────────────────────────────────

describe('createMeeting action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
    vi.mocked(insertMeeting).mockResolvedValue(7)
    vi.mocked(createEvent).mockResolvedValue({
      googleEventId: 'gid-7',
      meetLink: 'https://meet.example/7',
      googleIcalUid: 'uid-7',
      etag: '"etag-7"',
    })
  })

  describe('input validation', () => {
    it('rejects empty title (after trim)', async () => {
      const r = await createMeeting({ ...validCreateInput, title: '   ' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'title' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
      expect(insertMeeting).not.toHaveBeenCalled()
    })

    it('rejects invalid startAt', async () => {
      const r = await createMeeting({ ...validCreateInput, startAt: 'not-a-date' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'dates' })
    })

    it('rejects invalid endAt', async () => {
      const r = await createMeeting({ ...validCreateInput, endAt: 'not-a-date' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'dates' })
    })

    it('rejects endAt equal to startAt (zero duration)', async () => {
      const r = await createMeeting({
        ...validCreateInput,
        startAt: new Date('2026-07-01T13:00:00Z'),
        endAt: new Date('2026-07-01T13:00:00Z'),
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'end_before_start' })
    })

    it('rejects endAt before startAt', async () => {
      const r = await createMeeting({
        ...validCreateInput,
        startAt: new Date('2026-07-01T14:00:00Z'),
        endAt: new Date('2026-07-01T13:00:00Z'),
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'end_before_start' })
    })

    it('rejects empty timezone', async () => {
      const r = await createMeeting({ ...validCreateInput, timezone: '' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'timezone' })
    })

    it('GAP: allows startAt in the past (no server-side past guard)', async () => {
      // The form (MeetingFormDialog) and drag handler block past dates client-side,
      // but the server action does not. A direct action call with a past startAt
      // succeeds today. Documented for product decision.
      const r = await createMeeting({
        ...validCreateInput,
        startAt: new Date('2020-01-01T10:00:00Z'),
        endAt: new Date('2020-01-01T11:00:00Z'),
      })
      expect(r).toMatchObject({ ok: true })
    })

    it('GAP: allows sub-5-minute duration (no server-side min-duration check)', async () => {
      // updateMeeting enforces a 5-minute minimum (Phase 1 Task 4). createMeeting
      // does not. A 1-minute meeting can be created via direct action call.
      const r = await createMeeting({
        ...validCreateInput,
        startAt: new Date('2026-07-01T13:00:00Z'),
        endAt: new Date('2026-07-01T13:01:00Z'),
      })
      expect(r).toMatchObject({ ok: true })
    })
  })

  describe('lead linkage', () => {
    it('rejects invalid leadId type (negative)', async () => {
      const r = await createMeeting({ ...validCreateInput, leadId: -5 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'lead' })
    })

    it('rejects zero leadId', async () => {
      const r = await createMeeting({ ...validCreateInput, leadId: 0 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'lead' })
    })

    it('rejects unknown leadId (lead lookup returns null)', async () => {
      vi.mocked(getFullLead).mockResolvedValueOnce(null as any)
      const r = await createMeeting({ ...validCreateInput, leadId: 999 })
      expect(r).toEqual({ ok: false, reason: 'lead_not_found' })
    })

    it('rejects lead whose name field is missing (treats as not found)', async () => {
      vi.mocked(getFullLead).mockResolvedValueOnce({} as any)
      const r = await createMeeting({ ...validCreateInput, leadId: 999 })
      expect(r).toEqual({ ok: false, reason: 'lead_not_found' })
    })

    it('allows null leadId (no lookup performed)', async () => {
      const r = await createMeeting({ ...validCreateInput, leadId: null })
      expect(r).toMatchObject({ ok: true })
      expect(getFullLead).not.toHaveBeenCalled()
    })

    it('allows valid leadId and passes through to insertMeeting', async () => {
      vi.mocked(getFullLead).mockResolvedValueOnce({ name: 'Lead Name' } as any)
      await createMeeting({ ...validCreateInput, leadId: 17 })
      expect(insertMeeting).toHaveBeenCalledWith(expect.objectContaining({ leadId: 17 }))
    })
  })

  describe('attendees normalization', () => {
    it('lowercases and trims emails before insert + Google push', async () => {
      await createMeeting({
        ...validCreateInput,
        attendees: [{ email: '  Mixed.Case@Example.COM  ' }],
      })
      const normalized = vi.mocked(insertAttendees).mock.calls[0][1]
      expect(normalized.map((a) => a.email)).toEqual(['mixed.case@example.com'])
      const googleAttendees = vi.mocked(createEvent).mock.calls[0][0].attendees
      expect(googleAttendees).toEqual([{ email: 'mixed.case@example.com', displayName: null }])
    })

    it('dedupes attendees (case-insensitive)', async () => {
      await createMeeting({
        ...validCreateInput,
        attendees: [
          { email: 'a@x.com' },
          { email: 'A@X.COM' },
          { email: 'b@x.com' },
        ],
      })
      const normalized = vi.mocked(insertAttendees).mock.calls[0][1]
      expect(normalized.map((a) => a.email).sort()).toEqual(['a@x.com', 'b@x.com'])
    })

    it('drops malformed attendee emails silently', async () => {
      await createMeeting({
        ...validCreateInput,
        attendees: [
          { email: 'valid@example.com' },
          { email: 'no-at-sign' },
          { email: '' },
          { email: '   ' },
        ],
      })
      const normalized = vi.mocked(insertAttendees).mock.calls[0][1]
      expect(normalized.map((a) => a.email)).toEqual(['valid@example.com'])
    })

    it('skips insertAttendees when no valid attendees survive normalization', async () => {
      await createMeeting({
        ...validCreateInput,
        attendees: [{ email: 'bad' }, { email: '' }],
      })
      expect(insertAttendees).not.toHaveBeenCalled()
    })
  })

  describe('Google push outcome', () => {
    it('returns synced status and meetUrl on success', async () => {
      const r = await createMeeting(validCreateInput)
      expect(r).toMatchObject({
        ok: true,
        meetingId: 7,
        meetUrl: 'https://meet.example/7',
        syncStatus: 'synced',
      })
    })

    it("maps reauth_required CalendarApiError to syncStatus='reauth_required'", async () => {
      vi.mocked(createEvent).mockRejectedValueOnce(
        new CalendarApiError('reauth_required', 401, 'mocked'),
      )
      const r = await createMeeting(validCreateInput)
      expect(r).toMatchObject({ ok: true, syncStatus: 'reauth_required', meetUrl: null })
      expect(updateMeetingSyncState).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ status: 'reauth_required' }),
      )
    })

    it("maps server_error CalendarApiError to syncStatus='failed'", async () => {
      vi.mocked(createEvent).mockRejectedValueOnce(
        new CalendarApiError('server_error', 500, 'mocked'),
      )
      const r = await createMeeting(validCreateInput)
      expect(r).toMatchObject({ ok: true, syncStatus: 'failed', meetUrl: null })
    })

    it('CRM row is created regardless of Google push outcome', async () => {
      vi.mocked(createEvent).mockRejectedValueOnce(
        new CalendarApiError('server_error', 500, 'mocked'),
      )
      const r = await createMeeting(validCreateInput)
      expect(r.ok).toBe(true)
      expect(insertMeeting).toHaveBeenCalledTimes(1)
    })
  })
})

// ─── cancelMeeting ───────────────────────────────────────────────────────────

describe('cancelMeeting action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  describe('input + auth', () => {
    it('rejects non-numeric id', async () => {
      const r = await cancelMeeting('abc')
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('rejects zero id', async () => {
      const r = await cancelMeeting(0)
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('returns not_found for unknown meeting', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns not_owner when meeting belongs to another user', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 999 }))
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
    })

    it('scoped lookup by agency_id (tenant isolation)', async () => {
      setCurrentUser({ id: 100, agencyId: 9 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      await cancelMeeting(42)
      expect(getMeeting).toHaveBeenCalledWith(42, 9)
    })
  })

  describe('idempotency', () => {
    it("returns ok early when meeting is already cancelled, never touches DB or Google", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ status: 'cancelled' }))
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: true, syncStatus: 'synced' })
      expect(markMeetingCancelled).not.toHaveBeenCalled()
      expect(deleteEvent).not.toHaveBeenCalled()
    })
  })

  describe('terminal-outcome guard (Stage 2)', () => {
    it("rejects with reason='has_outcome' when meeting is already completed", async () => {
      // Without this guard a rep could destroy the completed_at audit row
      // AND email the lead a cancellation for a meeting they attended.
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ status: 'completed', completed_at: new Date('2026-06-01T11:00:00Z') }),
      )
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'has_outcome' })
      expect(markMeetingCancelled).not.toHaveBeenCalled()
      expect(deleteEvent).not.toHaveBeenCalled()
    })

    it("rejects with reason='has_outcome' when meeting is already no_show", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ status: 'no_show', no_show_at: new Date('2026-06-01T11:00:00Z') }),
      )
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'has_outcome' })
      expect(markMeetingCancelled).not.toHaveBeenCalled()
      expect(deleteEvent).not.toHaveBeenCalled()
    })
  })

  describe('Google delete', () => {
    it('marks cancelled locally BEFORE calling Google (CRM-first)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      const order: string[] = []
      vi.mocked(markMeetingCancelled).mockImplementationOnce(async () => {
        order.push('crm')
      })
      vi.mocked(deleteEvent).mockImplementationOnce(async () => {
        order.push('google')
      })
      await cancelMeeting(42)
      expect(order).toEqual(['crm', 'google'])
    })

    it('skips Google delete when google_event_id is null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ google_event_id: null }))
      const r = await cancelMeeting(42)
      expect(r).toEqual({ ok: true, syncStatus: 'synced' })
      expect(markMeetingCancelled).toHaveBeenCalledTimes(1)
      expect(deleteEvent).not.toHaveBeenCalled()
    })

    it("returns syncStatus='failed' and stores sync_error on Google delete failure", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(deleteEvent).mockRejectedValueOnce(
        new CalendarApiError('server_error', 500, 'mocked'),
      )
      const r = await cancelMeeting(42)
      expect(r).toMatchObject({ ok: true, syncStatus: 'failed' })
      expect(updateMeetingSyncState).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          status: 'failed',
          syncError: expect.stringContaining('cancel:api:server_error'),
        }),
      )
    })

    it("returns syncStatus='reauth_required' when Google needs reauth", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(deleteEvent).mockRejectedValueOnce(
        new CalendarApiError('reauth_required', 401, 'mocked'),
      )
      const r = await cancelMeeting(42)
      expect(r).toMatchObject({ ok: true, syncStatus: 'reauth_required' })
    })
  })
})

// ─── retrySyncMeeting ───────────────────────────────────────────────────────

describe('retrySyncMeeting action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
    vi.mocked(createEvent).mockResolvedValue({
      googleEventId: 'gid-retry',
      meetLink: 'https://meet.example/retry',
      googleIcalUid: 'uid-retry',
      etag: '"etag-retry"',
    })
  })

  describe('preconditions', () => {
    it('rejects non-numeric id', async () => {
      const r = await retrySyncMeeting('abc')
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('returns not_found for unknown id', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await retrySyncMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns not_owner for another user\'s meeting', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 999 }))
      const r = await retrySyncMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
    })

    it('returns already_synced for a cancelled meeting (status guard)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ status: 'cancelled' }))
      const r = await retrySyncMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'already_synced' })
    })
  })

  describe('Phase 1: only first-sync retries are allowed', () => {
    it('returns ok+synced shortcut when row already has google_event_id and is synced', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ sync_status: 'synced' }),
      )
      const r = await retrySyncMeeting(42)
      expect(r).toMatchObject({ ok: true, syncStatus: 'synced' })
      // The existing google_event_id means we never re-push (Phase 1 limitation:
      // events.insert isn't idempotent on iCalUID).
      expect(createEvent).not.toHaveBeenCalled()
    })

    it('returns already_synced when row has google_event_id but sync failed (no retry path in Phase 1)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ sync_status: 'failed' }),
      )
      const r = await retrySyncMeeting(42)
      expect(r).toEqual({ ok: false, reason: 'already_synced' })
    })

    it('pushes to Google when google_event_id is null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ google_event_id: null, sync_status: 'failed' }),
      )
      vi.mocked(getAttendeesForMeeting).mockResolvedValueOnce([])
      const r = await retrySyncMeeting(42)
      expect(r).toMatchObject({ ok: true, syncStatus: 'synced' })
      expect(createEvent).toHaveBeenCalledTimes(1)
    })

    it('strips organizer attendees from the retry push (only non-organizer rows sent)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ google_event_id: null, sync_status: 'failed' }),
      )
      vi.mocked(getAttendeesForMeeting).mockResolvedValueOnce([
        {
          id: 1,
          meeting_id: 42,
          email: 'organizer@x.com',
          display_name: null,
          user_id: 100,
          lead_id: null,
          response_status: 'needsAction',
          is_organizer: true,
          created_at: new Date(),
        },
        {
          id: 2,
          meeting_id: 42,
          email: 'lead@x.com',
          display_name: 'Lead',
          user_id: null,
          lead_id: 999,
          response_status: 'needsAction',
          is_organizer: false,
          created_at: new Date(),
        },
      ])
      await retrySyncMeeting(42)
      const sentAttendees = vi.mocked(createEvent).mock.calls[0][0].attendees
      expect(sentAttendees).toEqual([{ email: 'lead@x.com', displayName: 'Lead' }])
    })
  })
})

// ─── listUpcomingMeetings ───────────────────────────────────────────────────

describe('listUpcomingMeetings action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
    vi.mocked(dbListUpcomingMeetings).mockResolvedValue([])
  })

  it('passes through caller-supplied fromAt (the today-start anchor)', async () => {
    const todayStart = new Date('2026-07-01T00:00:00Z')
    await listUpcomingMeetings({ fromAt: todayStart })
    expect(dbListUpcomingMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ fromAt: todayStart }),
    )
  })

  it('defaults fromAt to now() when not provided', async () => {
    const before = Date.now()
    await listUpcomingMeetings()
    const after = Date.now()
    const fromAt = vi.mocked(dbListUpcomingMeetings).mock.calls[0][0].fromAt
    expect(fromAt).toBeInstanceOf(Date)
    expect((fromAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect((fromAt as Date).getTime()).toBeLessThanOrEqual(after)
  })

  it('scopes lookup by user.agencyId + user.id (tenant + owner isolation)', async () => {
    setCurrentUser({ id: 250, agencyId: 17 })
    await listUpcomingMeetings()
    expect(dbListUpcomingMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 17, organizerUserId: 250 }),
    )
  })

  it('forwards limit when provided', async () => {
    await listUpcomingMeetings({ limit: 25 })
    expect(dbListUpcomingMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25 }),
    )
  })

  it('returns DTOs (snake_case → camelCase mapping)', async () => {
    vi.mocked(dbListUpcomingMeetings).mockResolvedValueOnce([
      buildMeetingRow({ id: 5, title: 'A' }),
      buildMeetingRow({ id: 6, title: 'B' }),
    ])
    const r = await listUpcomingMeetings()
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ id: 5, title: 'A', meetUrl: expect.any(String) })
    expect(r[1]).toMatchObject({ id: 6, title: 'B' })
  })
})
