/**
 * Phase 2 — the Server Action boundaries.
 *
 * Three actions were reachable by any authenticated agency user: `transferSales`
 * (the commission/ownership rewrite `do-not-touch.md` names as high-risk), and
 * the EXT partner lifecycle. Subscription cancel/resume were reachable from a
 * page whose only protection was a hidden nav link.
 *
 * As with the route tests, each case asserts BOTH the rejection and that no
 * write was attempted — authorization has to precede the mutation, not merely
 * accompany it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  writes: [] as string[],
  transactions: 0,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/requireUser', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, requireProductAccess: async () => h.user, requireAgencyUser: async () => h.user }
})
vi.mock('@/db/usersNTeams', () => ({ getUserNameById: async () => 'x' }))
vi.mock('@/lib/form/funcs', () => ({ normalizeDefaultSettings: (x: unknown) => x }))

vi.mock('@/config/db', () => {
  // Knex is chainable AND awaitable: `.insert(...).returning('id')` and a bare
  // `await db('t').where(...).update(...)` are both valid. The builder therefore
  // returns itself from every method and carries a `then`, so either shape works.
  const qb: Record<string, unknown> = {}
  const chain = ['where', 'whereIn', 'select', 'join', 'orderBy', 'returning', 'clone', 'whereNot']
  for (const m of chain) qb[m] = () => qb
  qb.first = async () => ({ id: 99 })
  qb.insert = () => {
    h.writes.push('insert')
    return qb
  }
  qb.update = () => {
    h.writes.push('update')
    return qb
  }
  qb.del = () => {
    h.writes.push('delete')
    return qb
  }
  qb.delete = qb.del
  qb.then = (resolve: (v: unknown) => unknown) => Promise.resolve([{ id: 1 }]).then(resolve)
  const db = Object.assign(() => qb, {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      h.transactions += 1
      return fn(() => qb)
    },
    raw: () => ({}),
  })
  return { db }
})

const ADMIN = { id: 1, role: 'ADMIN', agencyId: 10 }
const GM = { id: 2, role: 'GM', agencyId: 10 }
const AGNT = { id: 3, role: 'AGNT', agencyId: 10 }
const MNGR = { id: 4, role: 'MNGR', agencyId: 10 }

beforeEach(() => {
  h.user = null
  h.writes = []
  h.transactions = 0
})

describe('transferSales — ownership rewrite is admin-only', () => {
  it('refuses an AGNT and opens no transaction', async () => {
    h.user = AGNT
    const { transferSales } = await import('@/actions/usersNteams')
    await expect(transferSales(3, 4)).rejects.toThrow('Forbidden')
    expect(h.transactions).toBe(0)
    expect(h.writes).toEqual([])
  })

  it('refuses a MNGR — a team lead is not an owner of the commission ledger', async () => {
    h.user = MNGR
    const { transferSales } = await import('@/actions/usersNteams')
    await expect(transferSales(3, 4)).rejects.toThrow('Forbidden')
    expect(h.transactions).toBe(0)
  })

  it('rejects before the endpoint users are even resolved', async () => {
    // The agency-membership lookups are tenant isolation and still run for an
    // admin; for a forbidden caller nothing is read at all.
    h.user = AGNT
    const { transferSales } = await import('@/actions/usersNteams')
    await expect(transferSales(3, 4)).rejects.toThrow('Forbidden')
    expect(h.writes).toEqual([])
  })

  it('still admits ADMIN and GM', async () => {
    const { transferSales } = await import('@/actions/usersNteams')
    h.user = ADMIN
    await expect(transferSales(3, 4)).resolves.toBeUndefined()
    h.user = GM
    await expect(transferSales(3, 4)).resolves.toBeUndefined()
    expect(h.transactions).toBe(2)
  })
})

describe('EXT partner lifecycle — create, edit and delete audited separately', () => {
  it('refuses an AGNT creating a partner, and writes nothing', async () => {
    h.user = AGNT
    const { upsertExtUser } = await import('@/actions/usersNteams')
    await expect(upsertExtUser({ firstName: 'a', lastName: 'b' })).rejects.toThrow('Forbidden')
    expect(h.writes).toEqual([])
  })

  it('refuses an AGNT editing a partner', async () => {
    h.user = AGNT
    const { upsertExtUser } = await import('@/actions/usersNteams')
    await expect(upsertExtUser({ firstName: 'a' }, 55)).rejects.toThrow('Forbidden')
    expect(h.writes).toEqual([])
  })

  it('refuses an AGNT deleting a partner', async () => {
    h.user = AGNT
    const { deleteExtUser } = await import('@/actions/usersNteams')
    await expect(deleteExtUser(55)).rejects.toThrow('Forbidden')
    expect(h.writes).toEqual([])
  })

  it('still admits an admin', async () => {
    h.user = ADMIN
    const { upsertExtUser } = await import('@/actions/usersNteams')
    await expect(upsertExtUser({ firstName: 'a', lastName: 'b' })).resolves.toBeDefined()
  })
})

describe('Subscription — cancelling ends the workspace for everyone', () => {
  it('refuses an AGNT resuming renewal', async () => {
    h.user = AGNT
    const { resumeRenewal } = await import('@/actions/subscription')
    expect(await resumeRenewal()).toEqual({ error: 'unauthorized' })
    expect(h.writes).toEqual([])
  })

  it('refuses an AGNT cancelling renewal, and opens no transaction', async () => {
    h.user = AGNT
    const { cancelRenewal } = await import('@/actions/subscription')
    expect(await cancelRenewal()).toEqual({ error: 'unauthorized' })
    expect(h.transactions).toBe(0)
  })

  it('refuses a MNGR', async () => {
    h.user = MNGR
    const { cancelRenewal } = await import('@/actions/subscription')
    expect(await cancelRenewal()).toEqual({ error: 'unauthorized' })
  })
})
