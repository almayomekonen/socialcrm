/**
 * Facebook Page-discovery classification + diagnostics.
 *
 * The defect these tests lock down: the /me/accounts HTTP-failure branch used
 * to report `NO_PAGES`, so a Meta API error and "this account administers no
 * Page" were indistinguishable in production — 33 `stage=discover` failures
 * across four agencies all carried the same reason.
 *
 * The invariants:
 *   · PROVIDER_ERROR          ← non-2xx from Meta (never NO_PAGES)
 *   · NO_PAGES                ← 2xx AND an empty Page list
 *   · PAGES_PERMISSION_MISSING← the Page permission was not granted at all
 *   · granular target_ids = 0 is DIAGNOSTIC, never a permission verdict
 *   · granular target_ids ARE the primary discovery source; /me/accounts is the
 *     fallback (regression from 7d601b1b: a Page authorised granularly but
 *     invisible to /me/accounts left the customer unable to connect)
 *   · no token/secret/code/Page id/Page token reaches a log line or analytics
 *
 * Unit-level (mocked db/fetch/auth/cookies) — see facebookConnect.test.ts for
 * why the DB harness is unavailable here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/db/auth', () => ({ getUser: vi.fn(), encrypt: vi.fn(async () => 'encrypted-blob') }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET } from '@/app/api/auth/facebook/callback/route'
import { getUser, encrypt } from '@/db/auth'
import { track } from '@/lib/analytics/track'
import { cookies } from 'next/headers'

const AGENCY = 64
const USER_ID = 293
const STATE = 'settings.state-uuid'
const CODE = 'AQD-oauth-authorization-code'
const APP_SECRET = 'super-secret-app-secret'
/** Realistic shape so the redaction assertions are meaningful. */
const USER_TOKEN = 'EAAGm0PX4ZCpsBA1ZBxLONGLIVEDUSERTOKENVALUE123456'
const FB_USER_ID = '10009988776655'

type Body = { status: number; body: unknown }

function res({ status, body }: Body) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const PERMS_FULL = { data: [{ permission: 'leads_retrieval', status: 'granted' }, { permission: 'pages_show_list', status: 'granted' }] }
const PERMS_NO_PAGES_SCOPE = { data: [{ permission: 'leads_retrieval', status: 'granted' }] }

function debugToken(targetIds: string[] | null) {
  return {
    data: {
      is_valid: true,
      user_id: FB_USER_ID,
      scopes: ['pages_show_list', 'leads_retrieval'],
      granular_scopes: targetIds === null ? [] : [{ scope: 'pages_show_list', target_ids: targetIds }],
    },
  }
}

const setCookies = () => {
  const store = {
    get: vi.fn(() => ({ value: STATE })),
    delete: vi.fn(),
    set: vi.fn(),
  }
  vi.mocked(cookies).mockResolvedValue(store as never)
  return store
}

/** Route only ever reads `req.url`. */
const req = () =>
  ({ url: `https://app.test/api/auth/facebook/callback?code=${CODE}&state=${STATE}` }) as unknown as import('next/server').NextRequest

/** `GET /{page-id}?fields=...` — the granular direct fetch. */
const directPage = (u: string) => {
  const m = u.match(/graph\.facebook\.com\/v19\.0\/([^?]+)\?fields=([^&]+)/)
  return m ? { id: m[1], fields: m[2] } : null
}
/** Key a `pages` entry by id, or by `id:fields` to answer one field set only. */
const pageKey = (id: string, fields: string) => `${id}:${fields}`

/**
 * `pages` maps a Page id to the direct-fetch response. A Page id that is not in
 * the map answers 400 — i.e. the granular source cannot resolve it, so the
 * `/me/accounts` fallback takes over. Omitting `pages` entirely therefore keeps
 * every pre-existing test exercising the exact path it was written for.
 */
function mockGraph({
  perms,
  debug,
  accounts,
  pages = {},
}: {
  perms: unknown
  debug: unknown
  accounts: Body
  pages?: Record<string, Body>
}) {
  global.fetch = vi.fn(async (input: unknown) => {
    const u = String(input)
    if (u.includes('oauth/access_token')) return res({ status: 200, body: { access_token: USER_TOKEN } })
    if (u.includes('/me/permissions')) return res({ status: 200, body: perms })
    if (u.includes('/debug_token')) return res({ status: 200, body: debug })
    if (u.includes('/me/accounts')) return res(accounts)
    const direct = directPage(u)
    if (direct) {
      const exact = pages[pageKey(direct.id, direct.fields)]
      return res(
        exact ?? pages[direct.id] ?? { status: 400, body: { error: { message: 'Unsupported get request', code: 100 } } },
      )
    }
    throw new Error(`unexpected fetch: ${u}`)
  }) as unknown as typeof fetch
}

const failProps = () => {
  const call = vi.mocked(track).mock.calls.find(([a]) => a.event === 'facebook_connect_failed')
  return call?.[0].props as Record<string, unknown> | undefined
}
const discoveredProps = () => {
  const call = vi.mocked(track).mock.calls.find(([a]) => a.event === 'facebook_page_discovered')
  return call?.[0].props as Record<string, unknown> | undefined
}
const location = (r: Response) => r.headers.get('location') ?? ''

beforeEach(() => {
  vi.stubEnv('META_APP_ID', '111222333')
  vi.stubEnv('META_APP_SECRET', APP_SECRET)
  vi.stubEnv('META_REDIRECT_URI', 'https://app.test/api/auth/facebook/callback')
  setCookies()
  vi.mocked(getUser).mockResolvedValue({ id: USER_ID, agencyId: AGENCY, email: 'x@example.com' } as never)
  vi.mocked(track).mockClear()
  // `encrypt` is a vi.mock factory fn — restoreAllMocks does not reset it, so
  // without this its call history leaks across tests.
  vi.mocked(encrypt).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Facebook Page discovery — classification', () => {
  it('FBD-1: 200 + empty data → NO_PAGES (provider answered, with zero Pages)', async () => {
    mockGraph({ perms: PERMS_FULL, debug: debugToken([]), accounts: { status: 200, body: { data: [] } } })

    const r = await GET(req())

    expect(location(r)).toContain('error=no_pages')
    const props = failProps()
    expect(props).toMatchObject({ reason: 'NO_PAGES', stage: 'discover', httpStatus: 200, returnedPageCount: 0, dataKeyPresent: true })
  })

  it('FBD-2: 200 + Pages → existing successful flow is unchanged', async () => {
    const pages = { data: [{ id: 'PG1', name: 'My Page', access_token: 'page-token-1' }] }
    mockGraph({ perms: PERMS_FULL, debug: debugToken(['PG1']), accounts: { status: 200, body: pages } })

    const r = await GET(req())

    expect(location(r)).toContain('/settings/facebook?select=1')
    expect(failProps()).toBeUndefined()
    expect(discoveredProps()).toMatchObject({ count: 1, returnedPageCount: 1, httpStatus: 200, grantedPageIdCount: 1 })
  })

  it('FBD-3: 400 OAuthException → PROVIDER_ERROR, never NO_PAGES, with Meta details captured', async () => {
    const metaError = {
      error: {
        message: 'Unsupported get request. Object with ID "me" does not exist',
        type: 'OAuthException',
        code: 100,
        error_subcode: 33,
        fbtrace_id: 'A1bCdEfGhIjK',
      },
    }
    mockGraph({ perms: PERMS_FULL, debug: debugToken(['PG1']), accounts: { status: 400, body: metaError } })

    const r = await GET(req())

    const props = failProps()
    expect(props?.reason).toBe('PROVIDER_ERROR')
    expect(props?.reason).not.toBe('NO_PAGES')
    expect(props).toMatchObject({
      stage: 'discover',
      httpStatus: 400,
      metaErrorCode: 100,
      metaErrorSubcode: 33,
      metaErrorType: 'OAuthException',
      fbtraceId: 'A1bCdEfGhIjK',
    })
    // User-facing notice stays generic — Meta internals never reach the browser.
    expect(location(r)).toContain('error=token')
    expect(location(r)).not.toContain('OAuthException')
    expect(location(r)).not.toContain('fbtrace')
  })

  it('FBD-3b: 403 non-2xx is also PROVIDER_ERROR', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG1']),
      accounts: { status: 403, body: { error: { message: 'permission denied', type: 'OAuthException', code: 200 } } },
    })

    await GET(req())

    expect(failProps()).toMatchObject({ reason: 'PROVIDER_ERROR', httpStatus: 403, metaErrorCode: 200 })
  })

  it('FBD-4: pages_show_list not granted → PAGES_PERMISSION_MISSING', async () => {
    mockGraph({ perms: PERMS_NO_PAGES_SCOPE, debug: debugToken(null), accounts: { status: 200, body: { data: [] } } })

    const r = await GET(req())

    expect(location(r)).toContain('error=pages_permission')
    expect(failProps()).toMatchObject({ reason: 'PAGES_PERMISSION_MISSING', pagesShowListGranted: false })
  })

  it('FBD-5: granted but target_ids empty → grantedPageIdCount 0, and NOT a permission failure', async () => {
    mockGraph({ perms: PERMS_FULL, debug: debugToken([]), accounts: { status: 200, body: { data: [] } } })

    await GET(req())

    const props = failProps()
    expect(props).toMatchObject({
      reason: 'NO_PAGES',
      pagesShowListGranted: true,
      grantedPageIdCount: 0,
      granularPagesEntryPresent: true,
      debugTokenOk: true,
    })
    expect(props?.reason).not.toBe('PAGES_PERMISSION_MISSING')
    // This is the discriminator the whole patch exists to produce.
    expect(props?.grantedPageIdCount).toBe(0)
  })

  it('FBD-5b: granted WITH Pages but /me/accounts empty → distinguishable from FBD-5', async () => {
    mockGraph({ perms: PERMS_FULL, debug: debugToken(['PG1', 'PG2']), accounts: { status: 200, body: { data: [] } } })

    await GET(req())

    expect(failProps()).toMatchObject({ reason: 'NO_PAGES', grantedPageIdCount: 2, returnedPageCount: 0 })
  })

  it('FBD-5c: 200 with no `data` key is distinguishable from an empty array', async () => {
    mockGraph({ perms: PERMS_FULL, debug: debugToken([]), accounts: { status: 200, body: {} } })

    await GET(req())

    expect(failProps()).toMatchObject({ reason: 'NO_PAGES', dataKeyPresent: false, returnedPageCount: 0 })
  })

  it('FBD-diag: debug_token failure degrades safely and never breaks the connection', async () => {
    global.fetch = vi.fn(async (input: unknown) => {
      const u = String(input)
      if (u.includes('oauth/access_token')) return res({ status: 200, body: { access_token: USER_TOKEN } })
      if (u.includes('/me/permissions')) return res({ status: 200, body: PERMS_FULL })
      if (u.includes('/debug_token')) return res({ status: 500, body: { error: { message: 'boom' } } })
      if (u.includes('/me/accounts')) return res({ status: 200, body: { data: [{ id: 'PG1', name: 'P', access_token: 't' }] } })
      throw new Error(`unexpected fetch: ${u}`)
    }) as unknown as typeof fetch

    const r = await GET(req())

    expect(location(r)).toContain('select=1')
    expect(discoveredProps()).toMatchObject({ debugTokenOk: false, grantedPageIdCount: null, returnedPageCount: 1 })
  })
})

describe('Facebook Page discovery — granular target_ids (regression: 7d601b1b)', () => {
  const PAGE_TOKEN = 'EAAGm0PX4ZCpsBAPAGEACCESSTOKENVALUE0099887766'
  const NPE_PAGE = { status: 200, body: { id: 'PG-NPE', name: 'Business Page', access_token: PAGE_TOKEN } }

  /** What the Page-select screen receives: encrypt({ pages, userId }). */
  const encrypted = () => vi.mocked(encrypt).mock.calls[0]?.[0] as { pages?: unknown[]; userId?: number } | undefined

  it('FBD-7: the production failure — /me/accounts empty, but the granular Page IS discovered', async () => {
    // Exactly the reported log line: valid token, pages_show_list granted,
    // 1 granular target_id, /me/accounts → 200 {"data":[]}.
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': NPE_PAGE },
    })

    const r = await GET(req())

    // Before this fix: error=no_pages. Now: on to the Page-select screen.
    expect(location(r)).toContain('/settings/facebook?select=1')
    expect(location(r)).not.toContain('error')
    expect(failProps()).toBeUndefined()
    expect(discoveredProps()).toMatchObject({
      count: 1,
      returnedPageCount: 1,
      discoverySource: 'granular',
      granularAttemptedCount: 1,
      granularResolvedCount: 1,
      grantedPageIdCount: 1,
    })
  })

  it('FBD-7b: the Page access token reaches the connection/persistence flow intact', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': NPE_PAGE },
    })

    await GET(req())

    // connect/route.ts requires all three; a missing one is a 400 "Missing fields".
    expect(encrypted()?.pages).toEqual([{ id: 'PG-NPE', name: 'Business Page', access_token: PAGE_TOKEN }])
    expect(encrypted()?.userId).toBe(USER_ID)
  })

  it('FBD-7c: /me/accounts is not called at all once granular resolves', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': NPE_PAGE },
    })

    await GET(req())

    const urls = vi.mocked(global.fetch).mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.includes('/me/accounts'))).toBe(false)
    expect(urls.some((u) => u.includes('fields=id,name,access_token'))).toBe(true)
  })

  it('FBD-7d: multiple authorised Pages all resolve', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-A', 'PG-B']),
      accounts: { status: 200, body: { data: [] } },
      pages: {
        'PG-A': { status: 200, body: { id: 'PG-A', name: 'A', access_token: 'tok-a' } },
        'PG-B': { status: 200, body: { id: 'PG-B', name: 'B', access_token: 'tok-b' } },
      },
    })

    await GET(req())

    expect(discoveredProps()).toMatchObject({ count: 2, granularAttemptedCount: 2, granularResolvedCount: 2 })
  })

  it('FBD-8: direct Page fetch fails → falls back to /me/accounts (existing behaviour preserved)', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [{ id: 'PG1', name: 'My Page', access_token: 'page-token-1' }] } },
      pages: { 'PG-NPE': { status: 400, body: { error: { message: 'nope', code: 100 } } } },
    })

    const r = await GET(req())

    expect(location(r)).toContain('select=1')
    expect(discoveredProps()).toMatchObject({
      count: 1,
      discoverySource: 'accounts',
      granularAttemptedCount: 1,
      granularResolvedCount: 0,
      httpStatus: 200,
    })
  })

  it('FBD-8b: a Page with no access_token is unusable → falls back rather than half-connecting', async () => {
    // Without a Page token connect/route.ts cannot subscribe leadgen webhooks,
    // so a saved-but-unsubscribed connection is worse than none.
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': { status: 200, body: { id: 'PG-NPE', name: 'No Token Page' } } },
    })

    const r = await GET(req())

    expect(location(r)).toContain('error=no_pages')
    expect(failProps()).toMatchObject({ reason: 'NO_PAGES', granularAttemptedCount: 1, granularResolvedCount: 0 })
  })

  it('FBD-8c: granular resolves nothing AND /me/accounts errors → still PROVIDER_ERROR', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 400, body: { error: { message: 'boom', type: 'OAuthException', code: 190 } } },
      pages: { 'PG-NPE': { status: 400, body: { error: { message: 'nope', code: 100 } } } },
    })

    await GET(req())

    expect(failProps()).toMatchObject({ reason: 'PROVIDER_ERROR', httpStatus: 400, metaErrorCode: 190 })
  })

  it('FBD-10: a rejected Page fetch records WHY — status, Meta code/type/message, field presence', async () => {
    // The blind spot this closes: fetchPageById used to answer a bare null for
    // every failure mode, so production saw granularResolvedCount 0 with no cause.
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: {
        'PG-NPE': {
          status: 400,
          body: {
            error: {
              message: 'Unsupported get request. Object with ID does not exist or lacks permissions',
              type: 'GraphMethodException',
              code: 100,
              error_subcode: 33,
              fbtrace_id: 'Zz9TraceId',
            },
          },
        },
      },
    })

    await GET(req())

    // Two attempts: the full read, then the name-less retry.
    const attempts = failProps()?.granularAttempts as Record<string, unknown>[] | undefined
    expect(attempts).toHaveLength(2)
    expect(attempts?.[0]).toMatchObject({
      httpStatus: 400,
      metaErrorCode: 100,
      metaErrorSubcode: 33,
      metaErrorType: 'GraphMethodException',
      fbtraceId: 'Zz9TraceId',
      hasId: false,
      hasName: false,
      hasAccessToken: false,
      graphVersion: 'v19.0',
      fieldsRequested: 'id,name,access_token',
    })
    expect(attempts?.[1]).toMatchObject({ fieldsRequested: 'id,access_token' })
    // The Page id is present only as a truncated, non-reversible hash.
    expect(String(attempts?.[0].pageIdHash)).toHaveLength(12)
    expect(attempts?.[0].pageIdHash).not.toBe('PG-NPE')
  })

  it('FBD-11: pages_read_engagement refused → name-less retry still yields the Page token', async () => {
    // The exact production rejection, verbatim from Meta 2026-08-20.
    const READ_ENGAGEMENT_REFUSAL = {
      status: 400,
      body: {
        error: {
          message:
            "This endpoint requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature or the 'Page Public Metadata Access' feature.",
          type: 'OAuthException',
          code: 100,
          fbtrace_id: 'RefusalTrace1',
        },
      },
    }
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: {
        // `name` is refused; `access_token` alone is granted by pages_show_list.
        'PG-NPE:id,name,access_token': READ_ENGAGEMENT_REFUSAL,
        'PG-NPE:id,access_token': { status: 200, body: { id: 'PG-NPE', access_token: PAGE_TOKEN } },
      },
    })

    const r = await GET(req())

    expect(location(r)).toContain('/settings/facebook?select=1')
    expect(discoveredProps()).toMatchObject({
      count: 1,
      discoverySource: 'granular',
      granularResolvedCount: 1,
      returnedPageCount: 1,
    })
    // Page id stands in for the name; the TOKEN is what the integration needs.
    expect(vi.mocked(encrypt).mock.calls[0]?.[0]).toMatchObject({
      pages: [{ id: 'PG-NPE', name: 'PG-NPE', access_token: PAGE_TOKEN }],
    })
  })

  it('FBD-11b: no pointless retry when the first read already succeeded', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE:id,name,access_token': NPE_PAGE },
    })

    await GET(req())

    const directCalls = vi
      .mocked(global.fetch)
      .mock.calls.map(([u]) => String(u))
      .filter((u) => u.includes('fields=id'))
    expect(directCalls).toHaveLength(1)
    expect(directCalls[0]).toContain('fields=id,name,access_token')
  })

  it('FBD-10b: a 200 Page object missing access_token is recorded as exactly that', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': { status: 200, body: { id: 'PG-NPE', name: 'No Token Page' } } },
    })

    await GET(req())

    expect((failProps()?.granularAttempts as Record<string, unknown>[])?.[0]).toMatchObject({
      httpStatus: 200,
      hasId: true,
      hasName: true,
      hasAccessToken: false,
      metaErrorCode: null,
    })
  })

  it('FBD-10c: a healthy connect records no per-Page attempt noise', async () => {
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': NPE_PAGE },
    })

    await GET(req())

    expect(discoveredProps()?.granularAttempts).toBeUndefined()
  })

  it('FBD-9: no Page id or Page access token in logs or analytics on the granular path', async () => {
    const logs: string[] = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      })
    }
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken(['PG-NPE']),
      accounts: { status: 200, body: { data: [] } },
      pages: { 'PG-NPE': NPE_PAGE },
    })

    await GET(req())

    const analytics = JSON.stringify(vi.mocked(track).mock.calls)
    const logged = logs.join('\n')
    for (const secret of [USER_TOKEN, PAGE_TOKEN, APP_SECRET, CODE, FB_USER_ID, 'PG-NPE']) {
      expect(analytics, `analytics leaked ${secret.slice(0, 8)}…`).not.toContain(secret)
      expect(logged, `logs leaked ${secret.slice(0, 8)}…`).not.toContain(secret)
    }
    // The counts that make the row diagnostic are still there.
    expect(analytics).toContain('granularResolvedCount')
  })
})

describe('Facebook Page discovery — credential safety', () => {
  const forbidden = [USER_TOKEN, APP_SECRET, CODE, FB_USER_ID, 'page-token-1']

  it('FBD-6: no token, secret, OAuth code, raw fb user id or Page token in analytics or logs', async () => {
    const logs: string[] = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      })
    }

    // Exercise both the provider-error and the empty-list paths.
    mockGraph({
      perms: PERMS_FULL,
      debug: debugToken([]),
      accounts: {
        status: 400,
        body: { error: { message: `Invalid token access_token=${USER_TOKEN}`, type: 'OAuthException', code: 190 } },
      },
    })
    await GET(req())

    const analytics = JSON.stringify(vi.mocked(track).mock.calls)
    const logged = logs.join('\n')

    for (const secret of forbidden) {
      expect(analytics, `analytics leaked ${secret.slice(0, 8)}…`).not.toContain(secret)
      expect(logged, `logs leaked ${secret.slice(0, 8)}…`).not.toContain(secret)
    }
    // The echoed token inside Meta's own message must be redacted, not dropped.
    expect(analytics).toContain('<redacted>')
    // The fb user id is present only as a truncated hash.
    const props = failProps()
    expect(String(props?.fbUserIdHash)).toHaveLength(12)
    expect(props?.fbUserIdHash).not.toBe(FB_USER_ID)
  })
})
