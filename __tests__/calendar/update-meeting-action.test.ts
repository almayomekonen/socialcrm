/**
 * Calendar — updateMeeting server action unit tests.
 *
 * DB-less by design: every @/db/* module and the calendarClient transport
 * are mocked. These tests pin the action's orchestration contract:
 *
 *   - Input validation runs BEFORE any DB or Google call
 *   - Ownership + tenant isolation
 *   - Cancelled meetings rejected
 *   - CRM-first ordering: local writes complete BEFORE updateEvent fires
 *   - Internal notes NEVER reach updateEvent
 *   - 'not_synced' branch when google_event_id is null (no Google call)
 *   - syncStatus mapping for synced / failed / reauth_required
 *   - 412 etag_mismatch → ok:false, reason:'conflict' (contract pinned for
 *     when Task 7 re-enables If-Match)
 *   - Phase 1: action sends etag=null (enforcement suspended)
 *   - attendees: undefined → omitted from patch; explicit array → replaced
 *     on both sides with normalization applied
 *   - sendUpdates default 'all' / drag handler 'externalOnly' override
 *   - Timezone fallback when caller patches start/end without timezone
 *
 * Run with VITEST_NO_DB=1 so setup.ts skips the schema reset entirely.
 */

import { vi } from 'vitest'

// ─── Mock Next.js infra ──────────────────────────────────────────────────────

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

vi.mock('@/lib/requireUser', () => ({
  requireUser: vi.fn(),
  requireAgencyUser: vi.fn(),
}))

// ─── Mock the DB layer ───────────────────────────────────────────────────────
// We need the action to be testable WITHOUT a real DB. The mocked helpers
// are interrogated for call args; tests configure return values per case.

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

// Mock calendarClient. Keep the real CalendarApiError class so action-layer
// instanceof checks behave correctly.
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

// ─── Imports (must come AFTER vi.mock calls — hoisting handles ordering) ────

import { describe, it, expect, beforeEach } from 'vitest'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingPatched,
  updateMeetingMutableFields,
  updateMeetingSyncState,
  type MeetingRow,
} from '@/db/meetings'
import { replaceAttendees } from '@/db/meetingAttendees'
import {
  updateEvent,
  CalendarApiError,
  type UpdateEventResult,
} from '@/lib/integrations/google/calendarClient'
import { updateMeeting } from '@/actions/calendar'

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

/**
 * Build a synced MeetingRow fixture. Override any field to exercise a branch.
 * Mirrors the DB shape exactly (snake_case columns).
 */
function buildMeetingRow(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 42,
    agency_id: 1,
    organizer_user_id: 100,
    lead_id: null,
    title: 'Original title',
    description: 'orig desc',
    location: 'orig loc',
    timezone: 'Asia/Jerusalem',
    start_at: new Date('2026-06-01T10:00:00Z'),
    end_at: new Date('2026-06-01T11:00:00Z'),
    status: 'scheduled',
    meet_url: 'https://meet.example/42',
    google_event_id: 'gid-42',
    google_ical_uid: 'uid-42',
    etag: '"original-etag"',
    sync_status: 'synced',
    sync_attempts: 0,
    sync_error: null,
    internal_notes: null,
    reminder_overrides: null,
    completed_at: null,
    no_show_at: null,
    last_refreshed_at: null,
    created_at: new Date('2026-05-30T08:00:00Z'),
    updated_at: new Date('2026-05-30T08:00:00Z'),
    ...overrides,
  }
}

function buildUpdateEventResult(overrides: Partial<UpdateEventResult> = {}): UpdateEventResult {
  return {
    googleEventId: 'gid-42',
    etag: '"new-etag"',
    meetLink: 'https://meet.example/42',
    startAt: '2026-06-01T10:00:00.000Z',
    endAt: '2026-06-01T11:00:00.000Z',
    attendees: [],
    ...overrides,
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('updateMeeting action', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — drains any queued mockResolvedValueOnce
    // / mockRejectedValueOnce that the previous test didn't consume (e.g. because
    // validation failed before reaching the mocked call). Without this, mocks
    // leak across tests and assertions see stale return values.
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  // ── Validation ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects non-numeric meetingId', async () => {
      const r = await updateMeeting({ meetingId: 'abc' as unknown as number, title: 'x' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'meetingId' })
      // Validation runs BEFORE auth — no requireAgencyUser call.
      expect(requireAgencyUser).not.toHaveBeenCalled()
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects zero meetingId', async () => {
      const r = await updateMeeting({ meetingId: 0, title: 'x' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'meetingId' })
    })

    it('rejects empty title (after trim)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      const r = await updateMeeting({ meetingId: 42, title: '   ' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'title' })
      // Title validation precedes any DB read.
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects empty timezone string when explicitly provided', async () => {
      const r = await updateMeeting({ meetingId: 42, timezone: '' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'timezone' })
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects invalid startAt', async () => {
      const r = await updateMeeting({ meetingId: 42, startAt: 'not-a-date' })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'startAt' })
    })

    it('rejects effective end <= effective start (uses existing values to fill gaps)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      // Existing: 10:00–11:00. Patch endAt to 09:30 (before existing start).
      const r = await updateMeeting({
        meetingId: 42,
        endAt: new Date('2026-06-01T09:30:00Z').toISOString(),
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'end_before_start' })
      // No writes happen on validation failure.
      expect(updateMeetingMutableFields).not.toHaveBeenCalled()
      expect(updateEvent).not.toHaveBeenCalled()
    })

    it('rejects sub-5-minute duration', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      const r = await updateMeeting({
        meetingId: 42,
        startAt: new Date('2026-06-01T10:00:00Z').toISOString(),
        endAt: new Date('2026-06-01T10:02:00Z').toISOString(),
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'duration_too_short' })
    })

    it('exactly 5-minute duration is accepted', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())
      const r = await updateMeeting({
        meetingId: 42,
        startAt: new Date('2026-06-01T10:00:00Z').toISOString(),
        endAt: new Date('2026-06-01T10:05:00Z').toISOString(),
      })
      expect(r.ok).toBe(true)
    })
  })

  // ── Ownership & tenant isolation ───────────────────────────────────────────

  describe('ownership', () => {
    it('returns not_found for an unknown meeting id', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await updateMeeting({ meetingId: 999, title: 'x' })
      expect(r).toEqual({ ok: false, reason: 'not_found' })
      expect(updateMeetingMutableFields).not.toHaveBeenCalled()
    })

    it('returns not_owner when organizer_user_id differs from current user', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ organizer_user_id: 999 }),
      )
      const r = await updateMeeting({ meetingId: 42, title: 'try me' })
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
      expect(updateMeetingMutableFields).not.toHaveBeenCalled()
    })

    it('looks up meeting scoped by user.agencyId (tenant isolation enforced at DB layer)', async () => {
      setCurrentUser({ id: 100, agencyId: 7 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null) // simulate wrong-tenant miss
      const r = await updateMeeting({ meetingId: 42, title: 'cross-tenant' })
      expect(getMeeting).toHaveBeenCalledWith(42, 7)
      expect(r).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  // ── Cancelled meetings ─────────────────────────────────────────────────────

  it('rejects updates to cancelled meetings', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ status: 'cancelled' }))
    const r = await updateMeeting({ meetingId: 42, title: 'try to revive' })
    expect(r).toEqual({ ok: false, reason: 'invalid_input', details: 'cancelled' })
    expect(updateMeetingMutableFields).not.toHaveBeenCalled()
    expect(updateEvent).not.toHaveBeenCalled()
  })

  // ── CRM-first ordering ─────────────────────────────────────────────────────

  describe('CRM-first ordering', () => {
    it('calls updateMeetingMutableFields BEFORE updateEvent', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())

      const callOrder: string[] = []
      vi.mocked(updateMeetingMutableFields).mockImplementationOnce(async () => {
        callOrder.push('crm-write')
      })
      vi.mocked(updateEvent).mockImplementationOnce(async () => {
        callOrder.push('google-patch')
        return buildUpdateEventResult()
      })

      await updateMeeting({ meetingId: 42, title: 'Renamed' })
      expect(callOrder).toEqual(['crm-write', 'google-patch'])
    })

    it('CRM write persists even when Google patch fails with a transient error', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(updateEvent).mockRejectedValueOnce(
        new CalendarApiError('server_error', 500, 'mocked 5xx'),
      )

      const r = await updateMeeting({ meetingId: 42, title: 'Persist after fail' })

      expect(r).toMatchObject({ ok: true, syncStatus: 'failed' })
      // CRM was written.
      expect(updateMeetingMutableFields).toHaveBeenCalledTimes(1)
      // sync_status was marked failed (error encoded as patch:api:server_error:500).
      expect(updateMeetingSyncState).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          status: 'failed',
          syncError: expect.stringContaining('patch:api:server_error'),
        }),
      )
    })
  })

  // ── 'not_synced' branch ────────────────────────────────────────────────────

  it("returns syncStatus='not_synced' for a meeting with null google_event_id", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(
      buildMeetingRow({ google_event_id: null, sync_status: 'pending', etag: null }),
    )

    const r = await updateMeeting({ meetingId: 42, title: 'Edited while pending' })

    expect(r).toMatchObject({ ok: true, syncStatus: 'not_synced' })
    // CRM write still happened.
    expect(updateMeetingMutableFields).toHaveBeenCalledTimes(1)
    // Google was NOT contacted.
    expect(updateEvent).not.toHaveBeenCalled()
  })

  // ── Success path ───────────────────────────────────────────────────────────

  it("returns syncStatus='synced' and refreshes etag via markMeetingPatched", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ etag: '"stale"' }))
    vi.mocked(updateEvent).mockResolvedValueOnce(
      buildUpdateEventResult({ etag: '"fresh-after-patch"' }),
    )

    const r = await updateMeeting({
      meetingId: 42,
      startAt: new Date('2026-06-01T13:00:00Z'),
      endAt: new Date('2026-06-01T14:00:00Z'),
    })

    expect(r).toMatchObject({ ok: true, syncStatus: 'synced' })
    expect(markMeetingPatched).toHaveBeenCalledWith(42, 1, '"fresh-after-patch"')
    // updateMeetingSyncState (the failure-state writer) NOT called on success.
    expect(updateMeetingSyncState).not.toHaveBeenCalled()
  })

  // ── reauth_required ────────────────────────────────────────────────────────

  it("maps reauth_required CalendarApiError to syncStatus='reauth_required'", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockRejectedValueOnce(
      new CalendarApiError('reauth_required', 401, 'mocked 401'),
    )

    const r = await updateMeeting({ meetingId: 42, title: 'After reauth fail' })

    expect(r).toMatchObject({ ok: true, syncStatus: 'reauth_required' })
    expect(updateMeetingMutableFields).toHaveBeenCalledTimes(1)
    expect(updateMeetingSyncState).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ status: 'reauth_required' }),
    )
  })

  it("maps missing_scope to syncStatus='reauth_required' as well", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockRejectedValueOnce(
      new CalendarApiError('missing_scope', 403, 'mocked 403'),
    )

    const r = await updateMeeting({ meetingId: 42, title: 'x' })
    expect(r).toMatchObject({ ok: true, syncStatus: 'reauth_required' })
  })

  // ── 412 conflict path (contract pinned for Task 7 re-enablement) ──────────

  it("returns ok:false reason='conflict' on CalendarApiError('etag_mismatch')", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockRejectedValueOnce(
      new CalendarApiError('etag_mismatch', 412, 'mocked 412'),
    )

    const r = await updateMeeting({ meetingId: 42, title: 'Conflicted' })
    expect(r).toEqual({ ok: false, reason: 'conflict' })
    // On conflict the CRM write already happened — sync_status NOT flipped to failed.
    expect(updateMeetingSyncState).not.toHaveBeenCalled()
  })

  // ── Internal notes never reach Google ──────────────────────────────────────

  it('internal_notes goes to CRM but NOT to updateEvent', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      internalNotes: 'offer 15% discount — DO NOT SHARE',
      title: 'public title',
    })

    // CRM patch includes internalNotes.
    const crmPatch = vi.mocked(updateMeetingMutableFields).mock.calls[0][2]
    expect(crmPatch.internalNotes).toBe('offer 15% discount — DO NOT SHARE')
    expect(crmPatch.title).toBe('public title')

    // Google patch DOES NOT include internalNotes (key absent on the object).
    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.title).toBe('public title')
    expect(Object.keys(googlePatch)).not.toContain('internalNotes')
    // Description must not have been mutated (caller didn't pass description).
    expect(googlePatch.description).toBeUndefined()
  })

  it('long internal_notes is truncated to 5000 chars', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    const huge = 'x'.repeat(7000)
    await updateMeeting({ meetingId: 42, internalNotes: huge })

    const crmPatch = vi.mocked(updateMeetingMutableFields).mock.calls[0][2]
    expect(crmPatch.internalNotes).toHaveLength(5000)
  })

  // ── Phase 1: etag enforcement suspended ────────────────────────────────────

  it('does NOT send the stored etag as If-Match (Phase 1 suspension)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(
      buildMeetingRow({ etag: '"would-be-stale"' }),
    )
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({ meetingId: 42, title: 'Suspended etag' })

    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.etag).toBeNull()
  })

  // ── Attendees replacement ──────────────────────────────────────────────────

  it('explicit attendees: replaces CRM list AND forwards normalized list to updateEvent', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      attendees: [{ email: 'NEW1@example.COM' }, { email: 'new2@example.com' }],
    })

    // CRM-side replacement (normalization happens in the action).
    expect(replaceAttendees).toHaveBeenCalledTimes(1)
    const crmAttendees = vi.mocked(replaceAttendees).mock.calls[0][1]
    expect(crmAttendees.map((a) => a.email).sort()).toEqual([
      'new1@example.com',
      'new2@example.com',
    ])

    // Google-side patch was given the normalized list.
    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.attendees).toEqual([
      { email: 'new1@example.com', displayName: null },
      { email: 'new2@example.com', displayName: null },
    ])
  })

  it('attendees omitted: replaceAttendees NOT called AND attendees absent from Google patch', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({ meetingId: 42, title: 'No attendee change' })

    expect(replaceAttendees).not.toHaveBeenCalled()
    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    // Critical: never accidentally clear Google's attendee list when the
    // caller didn't pass attendees.
    expect(googlePatch.attendees).toBeUndefined()
  })

  it('empty attendees array IS treated as "clear all" (distinct from undefined)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({ meetingId: 42, attendees: [] })

    expect(replaceAttendees).toHaveBeenCalledWith(42, [])
    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.attendees).toEqual([])
  })

  it('malformed attendee emails are dropped before reaching CRM or Google', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      attendees: [
        { email: 'valid@example.com' },
        { email: 'no-at-sign' },
        { email: '' },
        { email: 'another@valid.io' },
      ],
    })

    const crmAttendees = vi.mocked(replaceAttendees).mock.calls[0][1]
    expect(crmAttendees.map((a) => a.email).sort()).toEqual([
      'another@valid.io',
      'valid@example.com',
    ])
  })

  // ── sendUpdates default + override ─────────────────────────────────────────

  it("defaults sendUpdates to 'all' when caller omits it", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({ meetingId: 42, title: 'default-send-updates' })

    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.sendUpdates).toBe('all')
  })

  it("forwards sendUpdates='externalOnly' (the drag handler's choice)", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      startAt: new Date('2026-06-01T13:00:00Z'),
      endAt: new Date('2026-06-01T14:00:00Z'),
      sendUpdates: 'externalOnly',
    })

    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.sendUpdates).toBe('externalOnly')
  })

  // ── Timezone handling ──────────────────────────────────────────────────────

  it("falls back to the row's timezone when start/end change without timezone override", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(
      buildMeetingRow({ timezone: 'Asia/Jerusalem' }),
    )
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      startAt: new Date('2026-06-01T15:00:00Z'),
      endAt: new Date('2026-06-01T16:00:00Z'),
    })

    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.timezone).toBe('Asia/Jerusalem')
  })

  it("uses caller-supplied timezone when provided", async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(
      buildMeetingRow({ timezone: 'Asia/Jerusalem' }),
    )
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    await updateMeeting({
      meetingId: 42,
      startAt: new Date('2026-06-01T15:00:00Z'),
      endAt: new Date('2026-06-01T16:00:00Z'),
      timezone: 'Europe/Berlin',
    })

    const googlePatch = vi.mocked(updateEvent).mock.calls[0][0]
    expect(googlePatch.timezone).toBe('Europe/Berlin')
  })

  // ── String slicing safeguards ──────────────────────────────────────────────

  it('truncates title to 255 chars', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    const long = 'T'.repeat(400)
    await updateMeeting({ meetingId: 42, title: long })

    const crmPatch = vi.mocked(updateMeetingMutableFields).mock.calls[0][2]
    expect(crmPatch.title).toHaveLength(255)
  })

  it('truncates description to 5000 chars', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    const huge = 'd'.repeat(8000)
    await updateMeeting({ meetingId: 42, description: huge })

    const crmPatch = vi.mocked(updateMeetingMutableFields).mock.calls[0][2]
    expect(crmPatch.description).toHaveLength(5000)
  })

  it('truncates location to 255 chars', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
    vi.mocked(updateEvent).mockResolvedValueOnce(buildUpdateEventResult())

    const long = 'L'.repeat(400)
    await updateMeeting({ meetingId: 42, location: long })

    const crmPatch = vi.mocked(updateMeetingMutableFields).mock.calls[0][2]
    expect(crmPatch.location).toHaveLength(255)
  })
})
