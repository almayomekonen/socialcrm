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
 *   · no token/secret/code ever reaches a log line or the analytics row
 *
 * Unit-level (mocked db/fetch/auth/cookies) — see facebookConnect.test.ts for
 * why the DB harness is unavailable here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/db/auth', () => ({ getUser: vi.fn(), encrypt: vi.fn(async () => 'encrypted-blob') }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET } from '@/app/api/auth/facebook/callback/route'
import { getUser } from '@/db/auth'
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

function mockGraph({ perms, debug, accounts }: { perms: unknown; debug: unknown; accounts: Body }) {
  global.fetch = vi.fn(async (input: unknown) => {
    const u = String(input)
    if (u.includes('oauth/access_token')) return res({ status: 200, body: { access_token: USER_TOKEN } })
    if (u.includes('/me/permissions')) return res({ status: 200, body: perms })
    if (u.includes('/debug_token')) return res({ status: 200, body: debug })
    if (u.includes('/me/accounts')) return res(accounts)
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
