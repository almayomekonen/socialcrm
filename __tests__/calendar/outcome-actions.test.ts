/**
 * Calendar — markMeetingCompleted / markMeetingNoShow server action unit tests.
 *
 * DB-less by design (VITEST_NO_DB=1): every @/db/* module and the calendarClient
 * transport are mocked. Pins: input validation → tenant isolation → ownership →
 * idempotency (same outcome / cancelled) → happy path (DB call + revalidatePath
 * for /calendar, /dashboard, and /clients/:lead_id when set).
 */

import { vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('@/lib/requireUser', () => { const __au = vi.fn(); return { requireUser: vi.fn(), requireAgencyUser: __au, requireProductAccess: __au } })
vi.mock('@/db/meetings', () => ({
  getMeeting: vi.fn(),
  markMeetingCompleted: vi.fn(),
  markMeetingNoShow: vi.fn(),
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
vi.mock('@/db/clients', () => ({ getFullLead: vi.fn() }))
vi.mock('@/lib/integrations/google/calendarClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/integrations/google/calendarClient')>(
    '@/lib/integrations/google/calendarClient',
  )
  return { ...actual, createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn() }
})

// ─── Imports (must come AFTER vi.mock calls — hoisting handles ordering) ────

import { describe, it, expect, beforeEach } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import {
  getMeeting,
  markMeetingCompleted as dbMarkMeetingCompleted,
  markMeetingNoShow as dbMarkMeetingNoShow,
  type MeetingRow,
  type MeetingStatus,
} from '@/db/meetings'
import { getFullLead } from '@/db/clients'
import {
  markMeetingCompleted,
  markMeetingNoShow,
  type MarkMeetingCompletedResult,
  type MarkMeetingNoShowResult,
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

/**
 * Build a scheduled MeetingRow fixture. Override any field to exercise a branch.
 * Defaults: status='scheduled', completed_at=null, no_show_at=null,
 * lead_id=null, organizer_user_id=100, agency_id=1.
 */
function buildMeetingRow(overrides: Partial<MeetingRow> = {}): MeetingRow {
  const row: MeetingRow = {
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
    status: 'scheduled' as MeetingStatus,
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
  return row
}

// ─── Suites ──────────────────────────────────────────────────────────────────

describe('markMeetingCompleted action', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — drains any queued mockResolvedValueOnce
    // / mockRejectedValueOnce that the previous test didn't consume.
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  describe('input validation', () => {
    it('rejects string meetingId', async () => {
      const r: MarkMeetingCompletedResult = await markMeetingCompleted({
        meetingId: 'abc' as unknown as number,
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects zero meetingId', async () => {
      const r = await markMeetingCompleted({ meetingId: 0 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
    })

    it('rejects negative meetingId', async () => {
      const r = await markMeetingCompleted({ meetingId: -5 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
    })
  })

  describe('tenant isolation', () => {
    it('calls getMeeting with (meetingId, user.agencyId)', async () => {
      setCurrentUser({ id: 100, agencyId: 7 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      await markMeetingCompleted({ meetingId: 42 })
      expect(vi.mocked(getMeeting).mock.calls[0]).toEqual([42, 7])
    })

    it('returns not_found when getMeeting resolves to null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await markMeetingCompleted({ meetingId: 999 })
      expect(r).toEqual({ ok: false, reason: 'not_found' })
      expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
    })
  })

  describe('ownership', () => {
    it('returns not_owner when organizer differs from current user', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 999 }))
      const r = await markMeetingCompleted({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
      expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
    })
  })

  describe('idempotency', () => {
    it('returns existing completed_at when already completed (DB NOT called)', async () => {
      const existingCompletedAt = new Date('2026-05-31T12:00:00Z')
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({
          status: 'completed',
          completed_at: existingCompletedAt,
          lead_id: null,
        }),
      )
      const r = await markMeetingCompleted({ meetingId: 42 })
      // Stage 3: shape widened with leadId + suggestedLeadStatus (both null
      // here because lead_id is null on the row).
      expect(r).toEqual({
        ok: true,
        meetingId: 42,
        completedAt: existingCompletedAt.toISOString(),
        leadId: null,
        suggestedLeadStatus: null,
      })
      expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
    })

    it("rejects when meeting is cancelled with reason='already_cancelled'", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ status: 'cancelled' }))
      const r = await markMeetingCompleted({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'already_cancelled' })
      expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
    })

    it("rejects when meeting is already no_show with reason='already_no_show' (prevents double-stamp)", async () => {
      // Cross-outcome guard: a no_show meeting cannot transition to completed
      // without an undo first. Prevents leaving both completed_at and
      // no_show_at populated on the same row.
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({
          status: 'no_show',
          no_show_at: new Date('2026-06-01T11:00:00Z'),
        }),
      )
      const r = await markMeetingCompleted({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'already_no_show' })
      expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('calls db.markMeetingCompleted with (id, agencyId) and returns ISO completedAt', async () => {
      setCurrentUser({ id: 100, agencyId: 3 })
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ agency_id: 3 }))
      const r = await markMeetingCompleted({ meetingId: 42 })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.meetingId).toBe(42)
        // Valid ISO 8601 (Date.parse + round-trip equality).
        expect(new Date(r.completedAt).toISOString()).toBe(r.completedAt)
      }
      expect(vi.mocked(dbMarkMeetingCompleted).mock.calls[0]).toEqual([42, 3])
    })
  })

  describe('revalidatePath behavior', () => {
    it('revalidates /calendar and /dashboard on happy path', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      await markMeetingCompleted({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
      expect(paths).toContain('/calendar')
      expect(paths).toContain('/dashboard')
    })

    it('also revalidates /clients/:lead_id when meeting.lead_id is set', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 999 }))
      await markMeetingCompleted({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
      expect(paths).toContain('/clients/999')
    })

    it('does NOT revalidate any /clients/* path when lead_id is null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: null }))
      await markMeetingCompleted({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => String(c[0]))
      expect(paths.some((p) => p.startsWith('/clients/'))).toBe(false)
    })
  })
})

describe('markMeetingNoShow action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  describe('input validation', () => {
    it('rejects string meetingId', async () => {
      const r: MarkMeetingNoShowResult = await markMeetingNoShow({
        meetingId: 'abc' as unknown as number,
      })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
      expect(getMeeting).not.toHaveBeenCalled()
    })

    it('rejects zero meetingId', async () => {
      const r = await markMeetingNoShow({ meetingId: 0 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
    })

    it('rejects negative meetingId', async () => {
      const r = await markMeetingNoShow({ meetingId: -5 })
      expect(r).toEqual({ ok: false, reason: 'invalid_input' })
      expect(requireAgencyUser).not.toHaveBeenCalled()
    })
  })

  describe('tenant isolation', () => {
    it('calls getMeeting with (meetingId, user.agencyId)', async () => {
      setCurrentUser({ id: 100, agencyId: 7 })
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      await markMeetingNoShow({ meetingId: 42 })
      expect(vi.mocked(getMeeting).mock.calls[0]).toEqual([42, 7])
    })

    it('returns not_found when getMeeting resolves to null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(null)
      const r = await markMeetingNoShow({ meetingId: 999 })
      expect(r).toEqual({ ok: false, reason: 'not_found' })
      expect(dbMarkMeetingNoShow).not.toHaveBeenCalled()
    })
  })

  describe('ownership', () => {
    it('returns not_owner when organizer differs from current user', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ organizer_user_id: 999 }))
      const r = await markMeetingNoShow({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'not_owner' })
      expect(dbMarkMeetingNoShow).not.toHaveBeenCalled()
    })
  })

  describe('idempotency', () => {
    it('returns existing no_show_at when already no_show (DB NOT called)', async () => {
      const existingNoShowAt = new Date('2026-05-31T12:00:00Z')
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({ status: 'no_show', no_show_at: existingNoShowAt, lead_id: null }),
      )
      const r = await markMeetingNoShow({ meetingId: 42 })
      // Stage 3: shape widened with leadId + suggestedLeadStatus. no_show
      // always returns suggestedLeadStatus: null (no nudge on setbacks).
      expect(r).toEqual({
        ok: true,
        meetingId: 42,
        noShowAt: existingNoShowAt.toISOString(),
        leadId: null,
        suggestedLeadStatus: null,
      })
      expect(dbMarkMeetingNoShow).not.toHaveBeenCalled()
    })

    it("rejects when meeting is cancelled with reason='already_cancelled'", async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ status: 'cancelled' }))
      const r = await markMeetingNoShow({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'already_cancelled' })
      expect(dbMarkMeetingNoShow).not.toHaveBeenCalled()
    })

    it("rejects when meeting is already completed with reason='already_completed' (prevents double-stamp)", async () => {
      // Cross-outcome guard: a completed meeting cannot transition to no_show
      // without an undo first. Prevents leaving both completed_at and
      // no_show_at populated on the same row.
      vi.mocked(getMeeting).mockResolvedValueOnce(
        buildMeetingRow({
          status: 'completed',
          completed_at: new Date('2026-06-01T11:00:00Z'),
        }),
      )
      const r = await markMeetingNoShow({ meetingId: 42 })
      expect(r).toEqual({ ok: false, reason: 'already_completed' })
      expect(dbMarkMeetingNoShow).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('calls db.markMeetingNoShow with (id, agencyId) and returns ISO noShowAt', async () => {
      setCurrentUser({ id: 100, agencyId: 3 })
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ agency_id: 3 }))
      const r = await markMeetingNoShow({ meetingId: 42 })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.meetingId).toBe(42)
        expect(new Date(r.noShowAt).toISOString()).toBe(r.noShowAt)
      }
      expect(vi.mocked(dbMarkMeetingNoShow).mock.calls[0]).toEqual([42, 3])
    })
  })

  describe('revalidatePath behavior', () => {
    it('revalidates /calendar and /dashboard on happy path', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow())
      await markMeetingNoShow({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
      expect(paths).toContain('/calendar')
      expect(paths).toContain('/dashboard')
    })

    it('also revalidates /clients/:lead_id when meeting.lead_id is set', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 999 }))
      await markMeetingNoShow({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0])
      expect(paths).toContain('/clients/999')
    })

    it('does NOT revalidate any /clients/* path when lead_id is null', async () => {
      vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: null }))
      await markMeetingNoShow({ meetingId: 42 })
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => String(c[0]))
      expect(paths.some((p) => p.startsWith('/clients/'))).toBe(false)
    })
  })
})

// ─── Stage 3: lead-status suggestion (leadId + suggestedLeadStatus) ─────────
//
// These suites pin the contract the LeadStatusNudge UI relies on:
//   - `completed` consults getFullLead and maps via suggestNextLeadStatus.
//   - `no_show` NEVER returns a suggestion (null, regardless of lead status).
//   - Lead fetch failures (missing row, thrown error) degrade to null — the
//     outcome write has already committed; the nudge is best-effort.
//   - The shape (leadId + suggestedLeadStatus) is present on BOTH fresh-write
//     and idempotent re-mark paths.

function leadRow(status: string): any {
  return { id: 555, status }
}

describe('markMeetingCompleted — Stage 3 lead-status suggestion', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  it('returns suggestedLeadStatus=null when meeting has no lead_id (getFullLead NOT called)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: null }))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBeNull()
    expect(r.suggestedLeadStatus).toBeNull()
    expect(getFullLead).not.toHaveBeenCalled()
  })

  it('maps new → interested (meeting attendance beats outreach-stamp)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('new'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBe(555)
    expect(r.suggestedLeadStatus).toBe('interested')
  })

  it('maps contacted → interested', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('contacted'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.suggestedLeadStatus).toBe('interested')
  })

  it('maps interested → closed', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('interested'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.suggestedLeadStatus).toBe('closed')
  })

  it('returns null suggestion for terminal closed lead (no funnel-undo nudges)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('closed'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.suggestedLeadStatus).toBeNull()
  })

  it('returns null suggestion for terminal lost lead', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('lost'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.suggestedLeadStatus).toBeNull()
  })

  it('returns null suggestion when getFullLead resolves to null (lead deleted) — outcome still ok', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockResolvedValueOnce(null as any)
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBe(555)
    expect(r.suggestedLeadStatus).toBeNull()
  })

  it('returns null suggestion when getFullLead throws — outcome still ok (best-effort nudge)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    vi.mocked(getFullLead).mockRejectedValueOnce(new Error('db down'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBe(555)
    expect(r.suggestedLeadStatus).toBeNull()
  })

  it('idempotent path also includes leadId + suggestion (already-completed return)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(
      buildMeetingRow({
        status: 'completed',
        completed_at: new Date('2026-05-31T12:00:00Z'),
        lead_id: 555,
      }),
    )
    vi.mocked(getFullLead).mockResolvedValueOnce(leadRow('contacted'))
    const r = await markMeetingCompleted({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBe(555)
    expect(r.suggestedLeadStatus).toBe('interested')
    expect(dbMarkMeetingCompleted).not.toHaveBeenCalled()
  })
})

describe('markMeetingNoShow — Stage 3: never suggests a lead-status change', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setCurrentUser({ id: 100, agencyId: 1 })
  })

  it('returns suggestedLeadStatus=null even when lead is new (no_show is a setback, not a signal)', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    const r = await markMeetingNoShow({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.leadId).toBe(555)
    expect(r.suggestedLeadStatus).toBeNull()
    // getFullLead is not consulted on the no_show path — the suggestion is
    // statically null, so no DB round-trip.
    expect(getFullLead).not.toHaveBeenCalled()
  })

  it('returns suggestedLeadStatus=null even when lead is interested', async () => {
    vi.mocked(getMeeting).mockResolvedValueOnce(buildMeetingRow({ lead_id: 555 }))
    const r = await markMeetingNoShow({ meetingId: 42 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.suggestedLeadStatus).toBeNull()
  })
})
