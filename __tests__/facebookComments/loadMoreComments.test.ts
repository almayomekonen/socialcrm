/**
 * "טען עוד" — the next page of the comments inbox, as a server action.
 *
 * The browser supplies `status` and `cursor`; everything else — above all the
 * agency — comes from the session. A cursor is accepted only in the exact shape
 * the server issued, and an unknown status falls back to "הכל".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 7, agencyId: 103 } as { id: number; agencyId: number },
  enabled: true,
  load: vi.fn(),
  refresh: vi.fn(async () => ({ posts: 0, authors: 0 })),
  after: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock('next/server', () => ({ after: h.after }))
vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: async () => h.user }))
vi.mock('@/lib/facebook/comments/capability', () => ({ isFacebookCommentsEnabledForAgency: () => h.enabled }))
vi.mock('@/lib/facebook/comments/enrich', () => ({ refreshCommentContext: h.refresh }))
vi.mock('@/modules/facebookComments/feed', async (orig) => ({
  ...(await orig<typeof import('@/modules/facebookComments/feed')>()),
  loadCommentsFeedPage: h.load,
}))

import { loadMoreComments } from '@/modules/facebookComments/listActions'
import { parseCursor } from '@/modules/facebookComments/feed'

const cursor = { receivedAt: '2026-10-01T09:00:00.000Z', id: 42 }

beforeEach(() => {
  h.enabled = true
  h.load.mockReset().mockResolvedValue({ items: [{ id: 41 }], replies: [], posts: [], nextCursor: null })
  h.refresh.mockClear()
})

describe('loadMoreComments', () => {
  it('reads the next page for the SESSION agency and enriches only what it returned', async () => {
    const res = await loadMoreComments('open', cursor)
    expect(res).toMatchObject({ ok: true, items: [{ id: 41 }] })
    expect(h.load).toHaveBeenCalledWith(103, { status: 'open', cursor })
    expect(h.refresh).toHaveBeenCalledWith({ agencyId: 103, commentRowIds: [41] })
  })

  it('an unknown status falls back to "all" — no injection surface', async () => {
    await loadMoreComments("open' OR 1=1", cursor)
    expect(h.load).toHaveBeenCalledWith(103, { status: 'all', cursor })
  })

  it.each([
    null,
    'x',
    { receivedAt: 'not a date', id: 1 },
    { receivedAt: cursor.receivedAt, id: -1 },
    { receivedAt: cursor.receivedAt, id: 1.5 },
    { receivedAt: cursor.receivedAt, id: '1' },
  ])('refuses a cursor the server never issued: %p', async (bad) => {
    expect(await loadMoreComments('all', bad)).toEqual({ ok: false })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('does nothing for an agency outside the rollout', async () => {
    h.enabled = false
    expect(await loadMoreComments('all', cursor)).toEqual({ ok: false })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('a database failure is a typed failure, never a raw error', async () => {
    h.load.mockRejectedValueOnce(new Error('relation does not exist'))
    expect(await loadMoreComments('all', cursor)).toEqual({ ok: false })
  })
})

describe('parseCursor', () => {
  it('normalises a valid cursor to the server format', () => {
    expect(parseCursor({ receivedAt: '2026-10-01T09:00:00Z', id: 3 })).toEqual({ receivedAt: '2026-10-01T09:00:00.000Z', id: 3 })
  })
})
