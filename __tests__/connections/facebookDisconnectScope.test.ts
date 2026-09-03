/**
 * Facebook disconnect — scope regression.
 *
 * The failure this pins: an agency can hold several `facebook_pages` rows
 * (`page_id` is the unique column, not agency or user). A revision that resolved
 * ONE row with `.first()` to unsubscribe at Meta and then deleted the whole
 * matched set removed every Page in the agency while unsubscribing one, leaving
 * Meta delivering webhooks for a Page with no local row and no token to stop it.
 *
 * The db mock is a real in-memory table with working `where`/`first`/`delete`
 * rather than a call recorder, because the defect was that the SELECT and the
 * DELETE resolved different row sets. A recorder would have watched both calls
 * happen and reported success; only executing them shows the second row vanish.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = {
  id: number
  user_id: number
  agency_id: number
  page_id: string
  page_access_token: string
}

const h = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  unsubscribed: [] as string[],
  deleteFilters: [] as Record<string, unknown>[],
}))

vi.mock('@/db/auth', () => ({ getUser: async () => h.session }))

vi.mock('@/config/db', () => {
  function table() {
    const filters: Record<string, unknown>[] = []
    const matches = () =>
      h.rows.filter((r) => filters.every((f) => Object.entries(f).every(([k, v]) => r[k] === v)))
    const qb: Record<string, unknown> = {}
    qb.where = (f: Record<string, unknown>) => {
      filters.push(f)
      return qb
    }
    qb.first = async () => matches()[0]
    qb.delete = async () => {
      h.deleteFilters.push(Object.assign({}, ...filters))
      const doomed = new Set(matches())
      h.rows = h.rows.filter((r) => !doomed.has(r))
      return doomed.size
    }
    qb.del = qb.delete
    qb.clone = () => qb
    return qb
  }
  return { db: Object.assign(() => table(), { transaction: async () => {}, raw: () => ({}) }) }
})

const AGENCY = 10
const OTHER_AGENCY = 99
const ADMIN = { id: 1, role: 'ADMIN', agencyId: AGENCY, suspended: false }
const AGNT = { id: 2, role: 'AGNT', agencyId: AGENCY, suspended: false }
const SUSPENDED = { id: 1, role: 'ADMIN', agencyId: AGENCY, suspended: true }

/** Two Pages in ONE agency, owned by two different users — the failure shape. */
function twoPagesOneAgency(): Row[] {
  return [
    { id: 101, user_id: ADMIN.id, agency_id: AGENCY, page_id: 'page-admin', page_access_token: 'tok-admin' },
    { id: 102, user_id: AGNT.id, agency_id: AGENCY, page_id: 'page-agnt', page_access_token: 'tok-agnt' },
  ]
}

async function post() {
  const { POST } = await import('@/app/api/auth/facebook/disconnect/route')
  return POST(new Request('http://t/api/auth/facebook/disconnect', { method: 'POST' }) as never)
}

beforeEach(() => {
  h.session = null
  h.rows = twoPagesOneAgency()
  h.unsubscribed = []
  h.deleteFilters = []
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /graph\.facebook\.com\/v18\.0\/([^/]+)\/subscribed_apps/.exec(String(url))
    if (m) h.unsubscribed.push(m[1])
    return { ok: true, text: async () => '' } as never
  })
})

describe('an admin disconnecting with two Pages in the agency', () => {
  it('removes only their own row and leaves the colleague’s Page connected', async () => {
    h.session = ADMIN
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows.map((r) => r.id)).toEqual([102])
  })

  it('never leaves a Meta subscription orphaned — every deleted row was unsubscribed', async () => {
    h.session = ADMIN
    const before = h.rows.length
    await post()
    const deleted = before - h.rows.length
    expect(deleted).toBe(1)
    expect(h.unsubscribed).toEqual(['page-admin'])
    // The invariant, stated directly: one unsubscribe per row removed.
    expect(h.unsubscribed.length).toBe(deleted)
  })

  it('addresses the delete by primary key, not by a filter that can match more', async () => {
    h.session = ADMIN
    await post()
    expect(h.deleteFilters).toEqual([{ id: 101 }])
    // The exact regression: a delete filtered only by agency matched both rows.
    for (const f of h.deleteFilters) {
      expect(Object.keys(f)).toContain('id')
      expect(Object.keys(f)).not.toEqual(['agency_id'])
    }
  })

  it('does not select an arbitrary row — the row unsubscribed is the row deleted', async () => {
    h.session = ADMIN
    await post()
    expect(h.unsubscribed).toEqual(['page-admin'])
    expect(h.deleteFilters).toEqual([{ id: 101 }])
  })
})

describe('a non-admin disconnecting', () => {
  it('removes only their own row, exactly as before', async () => {
    h.session = AGNT
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows.map((r) => r.id)).toEqual([101])
    expect(h.unsubscribed).toEqual(['page-agnt'])
  })

  it('cannot reach a colleague’s Page', async () => {
    h.session = AGNT
    await post()
    expect(h.rows.some((r) => r.id === 101)).toBe(true)
  })

  it('is a no-op when they own no Page, and touches nobody else’s', async () => {
    h.session = { id: 77, role: 'AGNT', agencyId: AGENCY, suspended: false }
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows).toHaveLength(2)
    expect(h.unsubscribed).toEqual([])
  })
})

describe('tenant isolation and rejected callers', () => {
  it('never matches a row in another agency', async () => {
    h.rows = [
      { id: 201, user_id: ADMIN.id, agency_id: OTHER_AGENCY, page_id: 'page-other', page_access_token: 'tok-other' },
    ]
    h.session = ADMIN // same user id, different tenant on the row
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows).toHaveLength(1)
    expect(h.unsubscribed).toEqual([])
  })

  it('rejects an unauthenticated caller and deletes nothing', async () => {
    h.session = null
    const res = await post()
    expect(res.status).toBe(401)
    expect(h.rows).toHaveLength(2)
    expect(h.deleteFilters).toEqual([])
  })

  it('rejects a suspended user and deletes nothing', async () => {
    h.session = SUSPENDED
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.rows).toHaveLength(2)
    expect(h.deleteFilters).toEqual([])
  })

  it('does not unsubscribe anything for a rejected caller', async () => {
    h.session = SUSPENDED
    await post()
    expect(h.unsubscribed).toEqual([])
  })
})

describe('the unsubscribe is best-effort, and deletion still proceeds', () => {
  it('still removes the row when Meta rejects the unsubscribe', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, text: async () => 'nope' }) as never)
    h.session = ADMIN
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows.map((r) => r.id)).toEqual([102])
  })

  it('still removes the row when the unsubscribe throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network')
    })
    h.session = ADMIN
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.rows.map((r) => r.id)).toEqual([102])
  })
})
