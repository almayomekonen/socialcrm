/**
 * ads_read authorization round trip, dispatched from the shared Facebook
 * callback by the `ads.` state prefix. Exact-match CSRF, grant read from Meta,
 * nothing stored when declined, token stored sealed when granted — and the
 * Page-connection logic (Lead Ads) never runs for an ads return.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 8).toString('base64')
  process.env.META_APP_ID = 'APP'
  process.env.META_APP_SECRET = 'SECRET'
  process.env.META_REDIRECT_URI = 'https://getsocialcrm.com/api/auth/facebook/callback'
  process.env.FACEBOOK_ADS_REPORTING_ENABLED = '1'
  process.env.FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST = '103'
  return { jar: new Map<string, string>(), saved: [] as Record<string, unknown>[], discovered: 0 }
})

vi.mock('@/lib/api/routeAuth', () => ({
  requireAgencyAdmin: vi.fn(async () => ({ ok: true, user: { id: 7, agencyId: 103, role: 'ADMIN' } })),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (h.jar.has(k) ? { value: h.jar.get(k) } : undefined),
    set: (k: string, v: string) => void h.jar.set(k, v),
    delete: (k: string) => void h.jar.delete(k),
  }),
}))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/facebook/discoverPages', () => ({
  discoverFacebookPages: vi.fn(async () => {
    h.discovered++
    return { pages: [], diagnostics: {} }
  }),
}))
vi.mock('@/config/db', () => {
  const qb: Record<string, unknown> = {}
  qb.insert = (row: Record<string, unknown>) => {
    h.saved.push(row)
    return qb
  }
  qb.onConflict = () => qb
  qb.merge = async () => [1]
  return { db: Object.assign(() => qb, { raw: () => ({}) }) }
})

import { GET as CALLBACK } from '@/app/api/auth/facebook/callback/route'
import { GET as START } from '@/app/api/auth/facebook/ads/route'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'

let fetched: string[] = []
function mockMeta(perms: string[]) {
  fetched = []
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    fetched.push(u)
    if (u.includes('/oauth/access_token') && u.includes('grant_type=fb_exchange_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'LONG-USER-TOKEN', expires_in: 5184000 }) }
    }
    if (u.includes('/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'SHORT' }) }
    if (u.includes('/me/permissions')) {
      return { ok: true, status: 200, json: async () => ({ data: perms.map((permission) => ({ permission, status: 'granted' })) }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

const callback = (query: string) => CALLBACK(new Request(`https://getsocialcrm.com/api/auth/facebook/callback?${query}`) as never)
const location = (res: Response) => res.headers.get('location') ?? ''

beforeEach(() => {
  h.jar.clear()
  h.saved = []
  h.discovered = 0
})

describe('ads OAuth start', () => {
  it('asks for ads_read only — never ads_management, never Page permissions — with a fresh ads. state', async () => {
    const res = await START(new Request('https://getsocialcrm.com/api/auth/facebook/ads') as never)
    const params = new URL(location(res)).searchParams
    expect(params.get('scope')).toBe('ads_read')
    expect(params.get('state')).toMatch(/^ads\./)
    expect(h.jar.get('fb_oauth_state')).toBe(params.get('state'))
  })
})

describe('ads OAuth callback', () => {
  it('granted → long-lived token stored SEALED with its grant and expiry; Page discovery never runs', async () => {
    h.jar.set('fb_oauth_state', 'ads.abc')
    mockMeta(['ads_read', 'public_profile'])
    const res = await callback('state=ads.abc&code=CODE')

    expect(location(res)).toContain('/sum_sales/ads?connected=1')
    expect(h.discovered).toBe(0)
    const row = h.saved[0] as { accessToken: string; grantedScopes: string; tokenExpiresAt: Date; agencyId: number; userId: number }
    expect(row).toMatchObject({ agencyId: 103, userId: 7 })
    expect(row.accessToken.startsWith('scm1.')).toBe(true)
    expect(resolvePageAccessToken(row.accessToken)).toBe('LONG-USER-TOKEN')
    expect(JSON.parse(row.grantedScopes)).toContain('ads_read')
    expect(row.tokenExpiresAt).toBeInstanceOf(Date)
    // The permission check sends the token in a header, not the URL.
    expect(fetched.find((u) => u.includes('/me/permissions'))).not.toContain('LONG-USER-TOKEN')
  })

  it('ads_read unticked on Meta\'s screen → "declined", nothing stored', async () => {
    h.jar.set('fb_oauth_state', 'ads.abc')
    mockMeta(['public_profile'])
    const res = await callback('state=ads.abc&code=CODE')
    expect(location(res)).toContain('ads_error=declined')
    expect(h.saved).toHaveLength(0)
  })

  it('state mismatch → rejected before any code exchange', async () => {
    h.jar.set('fb_oauth_state', 'ads.expected')
    mockMeta(['ads_read'])
    const res = await callback('state=ads.forged&code=CODE')
    expect(location(res)).toContain('ads_error=state')
    expect(fetched).toHaveLength(0)
    expect(h.saved).toHaveLength(0)
  })

  it('user cancelled on Meta → "denied", no exchange', async () => {
    h.jar.set('fb_oauth_state', 'ads.abc')
    mockMeta(['ads_read'])
    const res = await callback('state=ads.abc&error=access_denied')
    expect(location(res)).toContain('ads_error=denied')
    expect(fetched).toHaveLength(0)
  })
})
