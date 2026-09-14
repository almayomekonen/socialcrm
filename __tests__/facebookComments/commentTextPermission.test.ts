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
  // The OAuth routes are admin-only (Phase 2 boundary); the fixture predated it.
  user: { id: 7, agencyId: 103, email: 'rep@example.com', role: 'ADMIN' } as Record<string, unknown> | null,
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
  h.user = { id: 7, agencyId: 103, email: 'rep@example.com', role: 'ADMIN' }
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

describe('OAuth dialog — per-feature permissions', () => {
  beforeEach(() => {
    process.env.FACEBOOK_MESSENGER_ENABLED = '1'
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = '103'
    process.env.FACEBOOK_COMMENT_REPLIES_ENABLED = '1'
    process.env.FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST = '103'
  })

  const scopeFor = async (url: string) => {
    const { GET } = await import('@/app/api/auth/facebook/route')
    const res = await GET(new Request(url) as never)
    return new URL(res.headers.get('location')!).searchParams.get('scope')!.split(',')
  }

  it('the plain connection does NOT ask for reply, messaging or ads permissions', async () => {
    const scope = await scopeFor('https://getsocialcrm.com/api/auth/facebook')
    for (const extra of ['pages_manage_engagement', 'pages_messaging', 'ads_read']) {
      expect(scope).not.toContain(extra)
    }
  })

  it('feature=comment_replies adds pages_manage_engagement and keeps Lead Ads permissions', async () => {
    const scope = await scopeFor('https://getsocialcrm.com/api/auth/facebook?feature=comment_replies')
    expect(scope).toEqual(expect.arrayContaining(['pages_manage_engagement', 'pages_read_user_content', 'leads_retrieval']))
    expect(scope).not.toContain('pages_messaging')
  })

  it('feature=messenger adds pages_messaging with its documented dependencies', async () => {
    const scope = await scopeFor('https://getsocialcrm.com/api/auth/facebook?feature=messenger')
    expect(scope).toEqual(expect.arrayContaining(['pages_messaging', 'pages_manage_metadata', 'pages_show_list']))
    expect(scope).not.toContain('pages_manage_engagement')
  })

  it('a feature outside the agency\'s rollout is ignored: base permissions only', async () => {
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = '999'
    const scope = await scopeFor('https://getsocialcrm.com/api/auth/facebook?feature=messenger')
    expect(scope).not.toContain('pages_messaging')
    expect(scope).toContain('leads_retrieval')
  })

  it('an unknown feature value is ignored, and the feature rides the CSRF state', async () => {
    const { GET } = await import('@/app/api/auth/facebook/route')
    const res = await GET(new Request('https://getsocialcrm.com/api/auth/facebook?feature=ads_management') as never)
    const params = new URL(res.headers.get('location')!).searchParams
    expect(params.get('scope')).not.toContain('ads_management')
    expect(params.get('state')).toBe(h.cookieJar.get('fb_oauth_state'))

    const res2 = await GET(new Request('https://getsocialcrm.com/api/auth/facebook?feature=messenger') as never)
    expect(new URL(res2.headers.get('location')!).searchParams.get('state')).toMatch(/^settings\.messenger\.[0-9a-f-]+$/)
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
