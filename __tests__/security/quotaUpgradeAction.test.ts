import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * actions/quota.ts upgradeAgencyToPro: a cross-tenant, payment-free Pro grant.
 * Only platform owners may call it; an agency ADMIN/GM (own agency or any
 * other) is refused before anything is written, and a manual grant can never
 * carry the `grow:` reason reserved for verified payments.
 */
const h = vi.hoisted(() => ({
  user: null as null | { id: number; agencyId: number; role: string; email: string },
  upgrade: vi.fn(async () => ({ success: true }) as const),
  track: vi.fn(async () => undefined),
}))
vi.mock('@/lib/requireUser', () => ({ requireUser: async () => h.user }))
vi.mock('@/lib/quota/performUpgrade', () => ({ performAgencyUpgrade: h.upgrade }))
vi.mock('@/lib/analytics/track', () => ({ track: h.track }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/quota', () => ({ getQuotaStatus: vi.fn() }))

import { upgradeAgencyToPro } from '@/actions/quota'

const OWNER = 'owner@platform.test'
beforeEach(() => {
  process.env.PLATFORM_OWNER_EMAILS = OWNER
  h.upgrade.mockClear()
  h.track.mockClear()
})

describe('upgradeAgencyToPro', () => {
  it.each([
    ['an agency ADMIN targeting another agency', { id: 7, agencyId: 10, role: 'ADMIN', email: 'admin@a.test' }, 20],
    ['an agency ADMIN targeting their own agency (free Pro)', { id: 7, agencyId: 10, role: 'ADMIN', email: 'admin@a.test' }, 10],
    ['an agency GM', { id: 8, agencyId: 10, role: 'GM', email: 'gm@a.test' }, 20],
    ['a rep', { id: 9, agencyId: 10, role: 'AGNT', email: 'rep@a.test' }, 10],
  ])('refuses %s, writing nothing', async (_label, user, target) => {
    h.user = user
    expect(await upgradeAgencyToPro(target, 'manual')).toEqual({ error: 'forbidden' })
    expect(h.upgrade).not.toHaveBeenCalled()
    expect(h.track).not.toHaveBeenCalled()
  })

  it('a platform owner can grant, and the grant is audited on the target agency', async () => {
    h.user = { id: 1, agencyId: 103, role: 'ADMIN', email: OWNER }
    expect(await upgradeAgencyToPro(42, 'comp:pilot')).toEqual({ success: true })
    expect(h.upgrade).toHaveBeenCalledWith(42, 'comp:pilot')
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ agencyId: 42, userId: 1, event: 'admin_plan_grant' }))
  })

  it.each([['grow:fake'], ['GROW:fake'], [''], ['x'.repeat(65)]])('a platform owner cannot use the reason %j', async (reason) => {
    h.user = { id: 1, agencyId: 103, role: 'ADMIN', email: OWNER }
    expect(await upgradeAgencyToPro(42, reason)).toEqual({ error: 'invalid_input' })
    expect(h.upgrade).not.toHaveBeenCalled()
  })

  it.each([[0], [-1], [1.5], [Number.NaN]])('rejects agency id %s', async (id) => {
    h.user = { id: 1, agencyId: 103, role: 'ADMIN', email: OWNER }
    expect(await upgradeAgencyToPro(id, 'manual')).toEqual({ error: 'invalid_input' })
    expect(h.upgrade).not.toHaveBeenCalled()
  })

  it('reports a missing agency without auditing a grant', async () => {
    h.user = { id: 1, agencyId: 103, role: 'ADMIN', email: OWNER }
    h.upgrade.mockResolvedValueOnce({ error: 'not_found' } as never)
    expect(await upgradeAgencyToPro(999, 'manual')).toEqual({ error: 'not_found' })
    expect(h.track).not.toHaveBeenCalled()
  })
})
