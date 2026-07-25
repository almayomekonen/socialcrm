/**
 * Calendar — getMeetingForEdit action tests.
 *
 * Covers the dedicated read action used by MeetingEditDialog to prefill the
 * edit form. Pins:
 *   - Input validation
 *   - Tenant isolation (lookup scoped by user.agencyId)
 *   - Ownership (only the organizer can load for edit)
 *   - DTO shape: snake_case columns → camelCase fields, ISO dates
 *   - Attendees: organizer rows filtered out
 *   - Loadability across sync states / past times / non-cancelled statuses
 *     (these are documented behaviors, not "bugs" — see `// CONTRACT:` notes)
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
import { getMeeting, type MeetingRow } from '@/db/meetings'
import {
  getAttendeesForMeeting,
  type MeetingAttendeeRow,
} from '@/db/meetingAttendees'
import { getMeetingForEdit } from '@/actions/calendar'

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
    title: 'Original title',
    description: 'orig desc',
    location: 'orig loc',
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

function buildAttendee(overrides: Partial<MeetingAttendeeRow> = {}): MeetingAttendeeRow {
  return {
    id: 1,
    meeting_id: 42,
    email: 'attendee@x.com',
    display_name: null,
    user_id: null,
    lead_id: null,
    response_status: 'needsAction',
    is_organizer: false,
    created_at: new Date(),
    ...overrides,
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('getMeetingForEdit action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
    vi.mocked(getAttendeesForMeeting).mockResolvedValue([])
  })

  // ── Input validation ───────────────────────────────────────────────────────

  describe('input validation', () => {
    it('rejects non-numeric string id', async () => {
      const r = await getMeetingForEdit('abc')
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects zero id', async () => {
      const r = await getMeetingForEdit(0)
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('rejects negative id', async () => {
      const r = await getMeetingForEdit(-5)
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('accepts numeric strings (parsed to number)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      const r = await getMeetingForEdit('42')
      expect(r.ok).toBe(true)
      expect(getMeeting).toHaveBeenCalledWith(42, 1)
    })
  })

  // ── Tenant isolation ───────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('scopes the DB lookup by user.agencyId', async () => {
      setCurrentUser({ id: 100, agencyId: 7 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      await getMeetingForEdit(42)
      expect(getMeeting).toHaveBeenCalledWith(42, 7)
    })

    it('returns not_found when the meeting belongs to a different agency (DB returns null)', async () => {
      setCurrentUser({ id: 100, agencyId: 9 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await getMeetingForEdit(42)
      expect(r).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  // ── Ownership ──────────────────────────────────────────────────────────────

  describe('ownership', () => {
    it('returns not_owner when meeting organizer is a different user in the same agency', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ organizer_user_id: 999 }),
      )
      const r = await getMeetingForEdit(42)
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
    })

    it('returns DTO when current user IS the organizer', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 100 }))
      const r = await getMeetingForEdit(42)
      expect(r.ok).toBe(true)
    })
  })

  // ── DTO shape ──────────────────────────────────────────────────────────────

  describe('DTO shape', () => {
    it('returns ISO strings for startAt and endAt', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({
          start_at: new Date('2026-07-01T10:00:00Z'),
          end_at: new Date('2026-07-01T11:30:00Z'),
        }),
      )
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting.startAt).toBe('2026-07-01T10:00:00.000Z')
      expect(r.meeting.endAt).toBe('2026-07-01T11:30:00.000Z')
    })

    it('returns camelCase keys (id, leadId, timezone, location)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ id: 42, lead_id: 17, timezone: 'Europe/Berlin', location: 'Tel Aviv' }),
      )
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting).toMatchObject({
        id: 42,
        leadId: 17,
        timezone: 'Europe/Berlin',
        location: 'Tel Aviv',
        title: 'Original title',
      })
    })

    it('passes through null location and null leadId', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ lead_id: null, location: null }),
      )
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting.leadId).toBeNull()
      expect(r.meeting.location).toBeNull()
    })

    it('does NOT expose internal_notes (Phase 1 form does not surface them)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ internal_notes: 'private note' }),
      )
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(Object.keys(r.meeting)).not.toContain('internalNotes')
      expect(Object.keys(r.meeting)).not.toContain('internal_notes')
    })
  })

  // ── Attendees filtering ────────────────────────────────────────────────────

  describe('attendees', () => {
    it('returns empty array when no attendees exist', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(getAttendeesForMeeting).mockResolvedValueOnce([])
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting.attendees).toEqual([])
    })

    it('FILTERS OUT rows with is_organizer=true', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(getAttendeesForMeeting).mockResolvedValueOnce([
        buildAttendee({ email: 'organizer@x.com', is_organizer: true }),
        buildAttendee({ email: 'lead@x.com', is_organizer: false }),
      ])
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting.attendees.map((a) => a.email)).toEqual(['lead@x.com'])
    })

    it('returns email + displayName pairs (preserves display name when present)', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      vi.mocked(getAttendeesForMeeting).mockResolvedValueOnce([
        buildAttendee({ email: 'a@x.com', display_name: 'Alice' }),
        buildAttendee({ email: 'b@x.com', display_name: null }),
      ])
      const r = await getMeetingForEdit(42)
      if (r.ok !== true) throw new Error('expected ok')
      expect(r.meeting.attendees).toEqual([
        { email: 'a@x.com', displayName: 'Alice' },
        { email: 'b@x.com', displayName: null },
      ])
    })
  })

  // ── Loadability across states (documented contract) ───────────────────────

  describe('CONTRACT: meeting state does not block load', () => {
    // These tests pin the current behavior. The action returns the DTO for any
    // meeting the user owns, regardless of sync/temporal/status. The UI (edit
    // dialog) is what blocks editing of cancelled meetings via its own
    // updateMeeting call. If product wants to harden this, the test will need
    // an update.

    it('loads a meeting with sync_status=failed', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ sync_status: 'failed', google_event_id: null }),
      )
      const r = await getMeetingForEdit(42)
      expect(r.ok).toBe(true)
    })

    it('loads a meeting with sync_status=reauth_required', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ sync_status: 'reauth_required' }),
      )
      const r = await getMeetingForEdit(42)
      expect(r.ok).toBe(true)
    })

    it('CONTRACT: loads a meeting whose startAt is in the past', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({
          start_at: new Date('2020-01-01T10:00:00Z'),
          end_at: new Date('2020-01-01T11:00:00Z'),
        }),
      )
      const r = await getMeetingForEdit(42)
      expect(r.ok).toBe(true)
      // The dialog's own submit validation will reject saving with a past
      // startAt — but the LOAD itself succeeds. Product-acceptable today.
    })

    it('CONTRACT: loads a cancelled meeting', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ status: 'cancelled' }),
      )
      const r = await getMeetingForEdit(42)
      expect(r.ok).toBe(true)
      // The dialog's updateMeeting submit will return reason='invalid_input',
      // details='cancelled' if the user tries to save — but the LOAD itself
      // succeeds.
    })
  })

  // ── Auth ordering ──────────────────────────────────────────────────────────

  describe('auth ordering', () => {
    it('input validation runs BEFORE requireAgencyUser', async () => {
      await getMeetingForEdit(-1)
      expect(requireAgencyUser).not.toHaveBeenCalled()
    })

    it('requireAgencyUser runs BEFORE the DB read', async () => {
      const order: string[] = []
      vi.mocked(requireAgencyUser).mockImplementationOnce(async () => {
        order.push('auth')
        return { id: 100, agencyId: 1, role: 'ADMIN', suspended: false, name: null, email: null, picture: null } as any
      })
      vi.mocked(getMeeting).mockImplementationOnce(async () => {
        order.push('db')
        return buildMeetingRow()
      })
      await getMeetingForEdit(42)
      expect(order).toEqual(['auth', 'db'])
    })

    it('attendees read runs AFTER ownership check passes', async () => {
      // Ownership-failed → attendees fetcher never called.
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 999 }))
      await getMeetingForEdit(42)
      expect(getAttendeesForMeeting).not.toHaveBeenCalled()
    })
  })
})
