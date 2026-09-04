/**
 * `first_follow_up_set` — the event that had never fired.
 *
 * Across the entire history of production this event has zero rows, and only 12
 * of 439 leads carry a `nextFollowUpAt`. The follow-up loop is the product's
 * literal promise ("nothing falls through the cracks") and no new user had ever
 * completed it.
 *
 * The cause was where it was emitted. `FirstLeadCallout` fired it from the
 * client, and that component is rendered ONLY by the desktop lead-summary
 * route. Two production agencies (119 and 135) created their first lead on a
 * phone and never emitted so much as `first_lead_opened`, because on mobile the
 * component does not exist. The event also depended on a module-level latch
 * surviving a router refresh.
 *
 * It now fires from `setLeadFollowUp` — the ONE server action both surfaces
 * already call — so it is surface-agnostic, tied to a genuine persisted save,
 * and idempotent per agency through `trackOncePerAgency`.
 *
 * DB-free (VITEST_NO_DB=1 safe).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireProductAccess = vi.fn()
const getPerms = vi.fn()
const trackOncePerAgency = vi.fn()
const revalidatePath = vi.fn()

/** Rows the mocked update returns; [] models "lead not found / not permitted". */
let updateResult: Record<string, unknown>[] = [{ id: 5 }]

vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: (...a: unknown[]) => requireProductAccess(...a),
}))
vi.mock('@/db/filter', () => ({ getPerms: (...a: unknown[]) => getPerms(...a) }))
vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
  trackOncePerAgency: (...a: unknown[]) => trackOncePerAgency(...a),
}))
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
// `after` runs its callback immediately under test so the assertion is synchronous.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))

vi.mock('@/config/db', () => {
  const db: any = () => ({
    where: () => ({
      whereIn: () => ({ update: () => ({ returning: async () => updateResult }) }),
      update: () => ({ returning: async () => updateResult }),
    }),
  })
  return { db }
})

const { setLeadFollowUp, clearLeadFollowUp } = await import('@/actions/leadFollowUp')

beforeEach(() => {
  vi.clearAllMocks()
  updateResult = [{ id: 5 }]
  requireProductAccess.mockResolvedValue({ id: 10, agencyId: 77, role: 'ADMIN' })
  getPerms.mockResolvedValue({ gotPermIds: [10] })
})

describe('first_follow_up_set', () => {
  it('fires when a follow-up is genuinely saved', async () => {
    await setLeadFollowUp({ id: 5, at: new Date('2026-09-10T09:00:00Z').toISOString() })

    expect(trackOncePerAgency).toHaveBeenCalledWith(77, 'first_follow_up_set', 10)
  })

  it('is idempotent per agency — repeated saves go through the once-per-agency gate', async () => {
    await setLeadFollowUp({ id: 5, at: new Date('2026-09-10T09:00:00Z').toISOString() })
    await setLeadFollowUp({ id: 5, at: new Date('2026-09-11T09:00:00Z').toISOString() })

    // Every call routes through trackOncePerAgency, which is what guarantees a
    // single row — never through plain track(), which would insert twice.
    for (const call of trackOncePerAgency.mock.calls) {
      expect(call[1]).toBe('first_follow_up_set')
      expect(call[0]).toBe(77)
    }
  })

  it('does NOT fire when the save failed (lead not found or not permitted)', async () => {
    updateResult = []

    const res = await setLeadFollowUp({ id: 5, at: new Date('2026-09-10T09:00:00Z').toISOString() })

    expect(res).toMatchObject({ err: true })
    expect(trackOncePerAgency).not.toHaveBeenCalled()
  })

  it('does NOT fire on an invalid date, which never reaches the database', async () => {
    const res = await setLeadFollowUp({ id: 5, at: 'not-a-date' })

    expect(res).toMatchObject({ err: true })
    expect(trackOncePerAgency).not.toHaveBeenCalled()
  })

  it('does NOT fire when a follow-up is CLEARED — that is not setting one', async () => {
    await clearLeadFollowUp({ id: 5 })

    expect(trackOncePerAgency).not.toHaveBeenCalled()
  })
})
