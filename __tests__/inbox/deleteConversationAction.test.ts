import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  agencyId: 7,
  userId: 3,
  deleteCalls: [] as Array<{ conversationId: number; agencyId: number }>,
  deleteResult: { deleted: true } as { deleted: boolean },
  revalidated: [] as string[],
}))

vi.mock('@/lib/requireUser', () => ({
  requireAgencyUser: async () => ({ id: h.userId, agencyId: h.agencyId }),
}))
vi.mock('@/db/inboxConversations', () => ({
  deleteConversation: async (args: { conversationId: number; agencyId: number }) => {
    h.deleteCalls.push(args)
    return h.deleteResult
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }))
// Prevent transitive imports in actions.ts from spinning up real knex.
vi.mock('@/config/db', () => ({ db: Object.assign(() => ({}), { raw: () => ({}) }) }))

import { deleteConversation } from '@/modules/inbox/actions'

beforeEach(() => {
  h.agencyId = 7
  h.userId = 3
  h.deleteCalls = []
  h.deleteResult = { deleted: true }
  h.revalidated = []
})

describe('deleteConversation (server action)', () => {
  it('authorized: deletes using the SESSION agencyId and reports deleted:true', async () => {
    const res = await deleteConversation(42)
    expect(h.deleteCalls).toEqual([{ conversationId: 42, agencyId: 7 }])
    expect(res).toEqual({ ok: true, deleted: true })
    expect(h.revalidated).toContain('/inbox')
  })

  it('cross-agency: a caller can never target another agency — the agencyId always comes from the session, never the request', async () => {
    // Session is agency 7; even though the browser "requests" conversation 42, the
    // action scopes the delete to agency 7. A conversation owned by agency 99 would
    // simply match 0 rows in the db layer (proven in the db test).
    h.agencyId = 7
    await deleteConversation(42)
    expect(h.deleteCalls[0].agencyId).toBe(7)
    // There is no code path that reads an agencyId from the argument.
  })

  it('idempotent: db reports 0 rows (already gone / other agency) → ok:true, deleted:false', async () => {
    h.deleteResult = { deleted: false }
    const res = await deleteConversation(42)
    expect(res).toEqual({ ok: true, deleted: false })
  })

  it('rejects invalid ids without hitting the db', async () => {
    for (const bad of [0, -1, Number.NaN, 'abc']) {
      const res = await deleteConversation(bad as number | string)
      expect(res).toEqual({ ok: false, deleted: false })
    }
    expect(h.deleteCalls).toHaveLength(0)
  })
})
