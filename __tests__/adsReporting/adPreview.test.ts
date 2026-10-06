import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Meta ad preview, server side: the URL validation that decides what may reach
 * the browser, the tenancy checks before the preview is requested, and the
 * server action's session-derived scope. Graph is faked at the fetch boundary.
 */

const h = vi.hoisted(() => ({
  connections: new Map<string, unknown>(),
  getAdConnection: vi.fn(),
  user: { id: 332, agencyId: 103, role: 'ADMIN' } as { id: number; agencyId: number; role: string },
  enabled: true,
}))
vi.mock('@/db/facebookAds', () => ({ getAdConnection: h.getAdConnection }))
vi.mock('@/lib/requireUser', () => ({ requireAgencyUser: async () => h.user }))
vi.mock('@/lib/facebook/permissions', () => ({ isFacebookAdsReportingEnabledForAgency: () => h.enabled }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { loadAdPreview, previewUrlFromHtml } from '@/lib/facebook/ads/adPreview'
import { getAdPreview } from '@/modules/adsReporting/actions'

const TOKEN = 'EAAG-secret-token-value'
const PREVIEW = 'https://www.facebook.com/ads/api/preview_iframe.php?d=AQKxJ7JPI6zJ&t=AQI_HMl6zgjX'
const iframe = (src: string) =>
  `<iframe src="${src.replace(/&/g, '&amp;')}" width="335" height="450" scrolling="yes" style="border: none;"></iframe>`

const connection = (selectedAccountId: string | null) => ({
  id: 1,
  token: TOKEN,
  grantedScopes: ['ads_read'],
  tokenExpiresAt: null,
  selectedAccountId,
})

type Route = (url: URL) => unknown
let requests: { url: URL; auth: string | null }[] = []
const realFetch = global.fetch
function graph(routes: { accounts?: string[]; adAccount?: Record<string, string>; body?: unknown }) {
  const route: Route = (url) => {
    if (url.pathname.endsWith('/me/adaccounts')) {
      return {
        data: (routes.accounts ?? ['act_1']).map((id) => ({ id, name: id, currency: 'ILS', timezone_name: 'Asia/Jerusalem' })),
      }
    }
    const preview = /^\/v\d+\.\d\/(\d+)\/previews$/.exec(url.pathname)
    if (preview) return { data: [{ body: routes.body ?? iframe(PREVIEW) }] }
    const ad = /^\/v\d+\.\d\/(\d+)$/.exec(url.pathname)
    if (ad) return { id: ad[1], account_id: (routes.adAccount ?? {})[ad[1]] ?? '1' }
    return { error: { message: 'unknown', code: 100 } }
  }
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push({ url, auth: new Headers(init?.headers).get('authorization') })
    return new Response(JSON.stringify(route(url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  requests = []
  h.enabled = true
  h.user = { id: 332, agencyId: 103, role: 'ADMIN' }
  h.getAdConnection
    .mockReset()
    .mockImplementation(async (agencyId: number) => (agencyId === 103 ? connection('act_1') : connection('act_2')))
})
afterEach(() => {
  global.fetch = realFetch
})

describe('previewUrlFromHtml — only a validated Meta preview URL may leave the server', () => {
  it('accepts www.facebook.com and business.facebook.com, decoding &amp;', () => {
    expect(previewUrlFromHtml(iframe(PREVIEW))).toBe(PREVIEW)
    const biz = PREVIEW.replace('www.', 'business.')
    expect(previewUrlFromHtml(iframe(biz))).toBe(biz)
  })
  it('rejects http, other hosts, look-alike hosts and other paths', () => {
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('https:', 'http:')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('www.facebook.com', 'evil.example')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('www.facebook.com', 'www.facebook.com.evil.example')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('www.facebook.com', 'm.facebook.com')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('/ads/api/preview_iframe.php', '/ads/api/other.php')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('/ads/api/preview_iframe.php', '/ads/api/preview_iframe.php/x')))).toBeNull()
  })
  it('rejects malformed or missing HTML', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      '<div>no iframe</div>',
      '<iframe src=></iframe>',
      '<iframe src="not a url"></iframe>',
      'x'.repeat(20001),
    ]) {
      expect(previewUrlFromHtml(bad)).toBeNull()
    }
  })
  it('never returns a URL carrying a token or anything beyond d and t', () => {
    expect(previewUrlFromHtml(iframe(`${PREVIEW}&access_token=${TOKEN}`))).toBeNull()
    expect(previewUrlFromHtml(iframe(`${PREVIEW}&redirect=https://evil.example`))).toBeNull()
    expect(previewUrlFromHtml(iframe('https://www.facebook.com/ads/api/preview_iframe.php'))).toBeNull()
    expect(previewUrlFromHtml(iframe(`${PREVIEW}#x`))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('https://', 'https://user:pw@')))).toBeNull()
    expect(previewUrlFromHtml(iframe(PREVIEW.replace('facebook.com/', 'facebook.com:8443/')))).toBeNull()
  })
})

describe('loadAdPreview — tenancy before the preview is requested', () => {
  it('returns only the validated URL, on v26.0, with the token only in the Authorization header', async () => {
    graph({})
    const out = await loadAdPreview(103, 332, '120251241635220323')
    expect(out).toEqual({ ok: true, url: PREVIEW })
    expect(Object.keys(out).sort()).toEqual(['ok', 'url'])
    expect(requests.map((r) => r.url.pathname)).toEqual([
      '/v26.0/me/adaccounts',
      '/v26.0/120251241635220323',
      '/v26.0/120251241635220323/previews',
    ])
    expect(requests[2].url.searchParams.get('ad_format')).toBe('MOBILE_FEED_STANDARD')
    for (const r of requests) {
      expect(r.url.toString()).not.toContain(TOKEN)
      expect(r.auth).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('an ad from another account is refused and its preview never requested', async () => {
    graph({ adAccount: { '555': '999' } })
    expect(await loadAdPreview(103, 332, '555')).toEqual({ ok: false })
    expect(requests.some((r) => r.url.pathname.endsWith('/previews'))).toBe(false)
  })

  it("another agency's connection cannot preview this agency's ad", async () => {
    // Agency 200's connection remembers act_2; ad 777 belongs to act_1 (agency 103's).
    graph({ accounts: ['act_1', 'act_2'], adAccount: { '777': '1' } })
    expect(await loadAdPreview(200, 900, '777')).toEqual({ ok: false })
    expect(h.getAdConnection).toHaveBeenCalledWith(200, 900)
    expect(requests.some((r) => r.url.pathname.endsWith('/previews'))).toBe(false)
  })

  it('a remembered account Meta no longer lists for this token is refused', async () => {
    graph({ accounts: ['act_3'] })
    expect(await loadAdPreview(103, 332, '120251241635220323')).toEqual({ ok: false })
    expect(requests.map((r) => r.url.pathname)).toEqual(['/v26.0/me/adaccounts'])
  })

  it('no connection, no ads_read, an expired token or no remembered account → refused without a preview read', async () => {
    graph({})
    for (const c of [
      null,
      { ...connection('act_1'), grantedScopes: [] },
      { ...connection('act_1'), tokenExpiresAt: new Date(Date.now() - 1000) },
      connection(null),
    ]) {
      h.getAdConnection.mockResolvedValueOnce(c)
      expect(await loadAdPreview(103, 332, '120251241635220323')).toEqual({ ok: false })
    }
    expect(requests.some((r) => r.url.pathname.endsWith('/previews'))).toBe(false)
  })

  it('an id that is not a Meta object id never reaches Graph', async () => {
    graph({})
    for (const bad of ['', '../me', '123/previews', 'act_1', 12 as unknown as string]) {
      expect(await loadAdPreview(103, 332, bad)).toEqual({ ok: false })
    }
    expect(requests).toHaveLength(0)
  })

  it("Meta's HTML never comes back: an unexpected preview shape is just 'unavailable'", async () => {
    graph({ body: '<script>alert(1)</script><iframe src="https://evil.example/x"></iframe>' })
    const out = await loadAdPreview(103, 332, '120251241635220323')
    expect(out).toEqual({ ok: false })
    expect(JSON.stringify(out)).not.toMatch(/iframe|script|evil/)
  })
})

describe('getAdPreview — scope comes from the session, never the browser', () => {
  it('uses the signed-in agency and user', async () => {
    graph({})
    expect(await getAdPreview('120251241635220323')).toEqual({ ok: true, url: PREVIEW })
    expect(h.getAdConnection).toHaveBeenCalledWith(103, 332)
  })
  it('refuses non-admins and agencies without the feature, without touching Meta', async () => {
    graph({})
    h.user = { id: 5, agencyId: 103, role: 'AGNT' }
    expect(await getAdPreview('120251241635220323')).toEqual({ ok: false })
    h.user = { id: 332, agencyId: 103, role: 'ADMIN' }
    h.enabled = false
    expect(await getAdPreview('120251241635220323')).toEqual({ ok: false })
    expect(requests).toHaveLength(0)
  })
})
