/**
 * P0-1 — activating the already-approved `pages_read_user_content`.
 *
 * The defect this pins: the permission was approved by Meta, and
 * `hasCommentTextCapability` was written so the feature would light up on its
 * own once granted — but the OAuth scope never asked for it, so the gate could
 * never become true and every comment rendered without text.
 *
 * Three separable facts are covered here, because they fail independently:
 *   1. the DIALOG asks for the permission (otherwise nothing downstream matters);
 *   2. the recorded grant is read back TOTALLY and fail-closed;
 *   3. a Page that predates the scope reports `needsReconnect`, because an
 *      already-issued token can never gain a scope in place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { COMMENT_TEXT_PERMISSION } from '@/lib/facebook/comments/capability'

const h = vi.hoisted(() => ({
  user: { id: 7, agencyId: 103, email: 'rep@example.com' } as Record<string, unknown> | null,
  cookieJar: new Map<string, string>(),
  pageRow: null as Record<string, unknown> | null,
}))

vi.mock('@/db/auth', () => ({
  getUser: async () => h.user,
  encrypt: async (v: unknown) => JSON.stringify(v),
  decrypt: async (v: string) => JSON.parse(v),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (h.cookieJar.has(k) ? { value: h.cookieJar.get(k) } : undefined),
    set: (k: string, v: string) => void h.cookieJar.set(k, v),
    delete: (k: string) => void h.cookieJar.delete(k),
  }),
}))

vi.mock('@/lib/analytics/track', () => ({ track: async () => {} }))

vi.mock('@/config/db', () => {
  const qb = () => {
    const b: Record<string, unknown> = {}
    b.where = () => b
    b.first = async () => h.pageRow
    return b
  }
  return { db: Object.assign(() => qb(), { raw: () => ({}) }) }
})

beforeEach(() => {
  h.user = { id: 7, agencyId: 103, email: 'rep@example.com' }
  h.cookieJar.clear()
  h.pageRow = null
  process.env.META_APP_ID = 'app-id'
  process.env.META_REDIRECT_URI = 'https://getsocialcrm.com/api/auth/facebook/callback'
  process.env.NEXT_PUBLIC_BASE_URL = 'https://getsocialcrm.com'
})

describe('OAuth dialog', () => {
  it('requests pages_read_user_content', async () => {
    const { GET } = await import('@/app/api/auth/facebook/route')
    const res = await GET(new Request('https://getsocialcrm.com/api/auth/facebook') as never)

    const scope = new URL(res.headers.get('location')!).searchParams.get('scope')!.split(',')
    expect(scope).toContain(COMMENT_TEXT_PERMISSION)
  })

  it('still requests every permission the shipped flow already depended on', async () => {
    const { GET } = await import('@/app/api/auth/facebook/route')
    const res = await GET(new Request('https://getsocialcrm.com/api/auth/facebook') as never)

    const scope = new URL(res.headers.get('location')!).searchParams.get('scope')!.split(',')
    // Lead Ads must not regress because a comments permission was added.
    for (const required of ['pages_show_list', 'pages_manage_metadata', 'leads_retrieval']) {
      expect(scope).toContain(required)
    }
  })
})

describe('parseGrantedScopes — total and fail-closed', () => {
  it('accepts a parsed array and a JSON string alike', async () => {
    const { parseGrantedScopes } = await import('@/db/facebook')
    expect(parseGrantedScopes(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseGrantedScopes('["a","b"]')).toEqual(['a', 'b'])
  })

  it('yields [] for every unusable shape rather than throwing', async () => {
    const { parseGrantedScopes } = await import('@/db/facebook')
    for (const bad of [null, undefined, '', 'not-json', 42, {}, [1, 2], [''], true]) {
      expect(parseGrantedScopes(bad)).toEqual([])
    }
  })
})

describe('getFacebookCommentTextCapability', () => {
  it('reports granted when the recorded scope set carries the permission', async () => {
    h.pageRow = { granted_scopes: JSON.stringify(['leads_retrieval', COMMENT_TEXT_PERMISSION]) }
    const { getFacebookCommentTextCapability } = await import('@/db/facebook')

    expect(await getFacebookCommentTextCapability(103)).toEqual({
      connected: true,
      granted: true,
      needsReconnect: false,
    })
  })

  it('degrades safely and asks for a reconnect when the permission is absent', async () => {
    // A Page connected before the scope was requested — the exact production state.
    h.pageRow = { granted_scopes: JSON.stringify(['pages_show_list', 'leads_retrieval']) }
    const { getFacebookCommentTextCapability } = await import('@/db/facebook')

    expect(await getFacebookCommentTextCapability(103)).toEqual({
      connected: true,
      granted: false,
      needsReconnect: true,
    })
  })

  it('treats a row that predates the column as unknown, not as granted', async () => {
    h.pageRow = { granted_scopes: '[]' }
    const { getFacebookCommentTextCapability } = await import('@/db/facebook')

    const cap = await getFacebookCommentTextCapability(103)
    expect(cap.granted).toBe(false)
    expect(cap.needsReconnect).toBe(true)
  })

  it('offers no reconnect when there is no connection at all', async () => {
    h.pageRow = null
    const { getFacebookCommentTextCapability } = await import('@/db/facebook')

    // "Connect" is the right prompt here, and the settings page already owns it.
    expect(await getFacebookCommentTextCapability(103)).toEqual({
      connected: false,
      granted: false,
      needsReconnect: false,
    })
  })

  it('rejects a non-positive agency id without touching the database', async () => {
    h.pageRow = { granted_scopes: JSON.stringify([COMMENT_TEXT_PERMISSION]) }
    const { getFacebookCommentTextCapability } = await import('@/db/facebook')

    for (const bad of [0, -1, NaN]) {
      expect(await getFacebookCommentTextCapability(bad)).toEqual({
        connected: false,
        granted: false,
        needsReconnect: false,
      })
    }
  })
})
