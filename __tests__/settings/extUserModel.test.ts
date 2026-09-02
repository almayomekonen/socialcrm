/**
 * EXT is an assignment label, not an account — and must stay that way.
 *
 * The fix for the "team member" trap was wording plus a link. This pins the part
 * that must NOT have moved with it: no email, no role, no login can be written
 * through this path, whatever the client sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ inserted: null as Record<string, unknown> | null, updated: null as Record<string, unknown> | null }))

vi.mock('@/config/db', () => ({
  db: () => ({
    where: () => ({
      update: (row: Record<string, unknown>) => {
        h.updated = row
        return { returning: async () => [{ id: 7 }] }
      },
      first: async () => ({ id: 7 }),
    }),
    insert: (row: Record<string, unknown>) => {
      h.inserted = row
      return { returning: async () => [{ name: 'x' }] }
    },
  }),
}))
vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: async () => ({ id: 5, agencyId: 42, role: 'ADMIN' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { upsertExtUser } from '@/actions/usersNteams'

beforeEach(() => {
  h.inserted = null
  h.updated = null
})

describe('upsertExtUser stays assignment-only', () => {
  it('always writes role EXT, scoped to the caller’s agency', async () => {
    await upsertExtUser({ firstName: 'שיר', lastName: 'צלניק' })
    expect(h.inserted?.role).toBe('EXT')
    expect(h.inserted?.agencyId).toBe(42)
    expect(h.inserted?.createdById).toBe(5)
  })

  it('refuses to write an email or a login identity, even if asked', async () => {
    await upsertExtUser({
      firstName: 'דד',
      email: 'someone@example.com',
      gglSub: 'google-sub',
      role: 'ADMIN',
      password: 'x',
    } as never)
    expect(h.inserted).not.toHaveProperty('email')
    expect(h.inserted).not.toHaveProperty('gglSub')
    expect(h.inserted).not.toHaveProperty('password')
    // role is forced, never taken from input.
    expect(h.inserted?.role).toBe('EXT')
  })

  it('an edit cannot escalate an existing EXT record either', async () => {
    await upsertExtUser({ firstName: 'שיר', email: 'a@b.c', role: 'ADMIN' } as never, 7)
    expect(h.updated).not.toHaveProperty('email')
    expect(h.updated).not.toHaveProperty('role')
  })
})
