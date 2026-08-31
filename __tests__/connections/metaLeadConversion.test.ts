/**
 * Meta Ads "Lead" conversion tests.
 *
 * The campaign's Lead == a successfully PERSISTED Facebook Page connection.
 * Not a registration, not a page visit, not onboarding, not an OAuth start, and
 * not an OAuth callback (which persists nothing but a short-lived cookie).
 *
 * These tests pin both halves of that contract: the event fires exactly once at
 * the authoritative success point, and fires nowhere else.
 *
 * Unit-level (mocked db/fetch/auth) — see whatsappEmbeddedSignup.test.ts for why
 * the DB harness is unavailable here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import path from 'path'

const h = vi.hoisted(() => {
  /** `after()` callbacks scheduled by the route, awaited via flushAfter(). */
  const pending: Promise<unknown>[] = []
  const state = {
    /** rows visible to `db('analytics_events').where(...).first()` */
    leadMarker: null as unknown,
    /** existing facebook_pages row for the tenancy check */
    existingPage: null as { agency_id: number } | null,
    merged: [] as unknown[],
    tracked: [] as { event: string; agencyId: number }[],
  }

  function qb(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {}
    b.where = () => b
    b.whereRaw = () => b
    b.first = async () => (table === 'analytics_events' ? state.leadMarker : state.existingPage)
    b.insert = () => b
    b.onConflict = () => b
    b.merge = async (obj: unknown) => {
      state.merged.push(obj)
      return [1]
    }
    return b
  }

  const db = Object.assign((table: string) => qb(table), { raw: async () => ({}) })
  return { state, db, pending }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(async ({ event, agencyId }: { event: string; agencyId: number }) => {
    h.state.tracked.push({ event, agencyId })
  }),
  trackFirstRealLeadOnce: vi.fn(),
}))
vi.mock('@/lib/events/emit', () => ({ emitLifecycleEvent: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
}))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  // `after()` normally defers past the response; run it inline and AWAIT it so the
  // assertions observe the tracking work the route scheduled.
  return { ...actual, after: (cb: () => unknown) => void h.pending.push(Promise.resolve(cb())) }
})

const flushAfter = async () => {
  await Promise.all(h.pending)
  h.pending.length = 0
}

import { POST } from '@/app/api/auth/facebook/connect/route'
import { GET as OAUTH_START } from '@/app/api/auth/facebook/route'
import { sendFacebookConnectedLeadOnce, facebookConnectedLeadEventId } from '@/lib/facebook/metaLeadConversion'
import { getUser } from '@/db/auth'

const AGENCY = 69
const USER = 1
const PIXEL_ID = '2587091141705317'

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** All Graph calls made during the test, so we can isolate the CAPI /events ones. */
let calls: { url: string; init?: RequestInit }[] = []

function mockFetch({ subscribedOk = true, capiOk = true }: { subscribedOk?: boolean; capiOk?: boolean } = {}) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/events?')) return capiOk ? res(200, { events_received: 1 }) : res(400, { error: { code: 190 } })
    if (u.includes('subscribed_apps')) {
      return subscribedOk ? res(200, { success: true, data: [] }) : res(400, { error: { message: 'no perm' } })
    }
    return res(200, { data: [] })
  }) as unknown as typeof fetch
}

/** CAPI events actually delivered to Meta, decoded. */
function capiEvents() {
  return calls
    .filter((c) => c.url.includes('/events?'))
    .map((c) => JSON.parse(String(c.init?.body)).data[0] as Record<string, unknown>)
}

const leadEvents = () => capiEvents().filter((e) => e.event_name === 'Lead')

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    url: 'https://getsocialcrm.com/api/auth/facebook/connect',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as import('next/server').NextRequest
}

const validBody = { pageId: 'PG1', pageName: 'My Page', pageAccessToken: 'ptok' }

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', PIXEL_ID)
  vi.stubEnv('META_CAPI_ACCESS_TOKEN', 'test-capi-token')
  vi.stubEnv('META_CAPI_TEST_EVENT_CODE', '')
  // CAPI now refuses to send outside production, so a test that observes a real
  // send has to declare a sending environment. Setup only — every ML-* assertion
  // below is unchanged. See lib/facebook/pixelEnv.ts.
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
  h.state.leadMarker = null
  h.state.existingPage = null
  h.state.merged = []
  h.state.tracked = []
  calls = []
  h.pending.length = 0
  vi.mocked(getUser).mockResolvedValue({ id: USER, agencyId: AGENCY, email: 'Rep@Example.com ' } as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('Meta Lead conversion — fires only at the authoritative success point', () => {
  it('ML-1: first successful, persisted Facebook connection emits exactly one Lead', async () => {
    mockFetch()
    const r = await POST(req(validBody, { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))
    await flushAfter()

    expect(r.status).toBe(200)
    expect(h.state.merged).toHaveLength(1) // connection genuinely persisted
    expect(leadEvents()).toHaveLength(1)

    const event = leadEvents()[0]
    expect(event.event_name).toBe('Lead')
    expect(event.action_source).toBe('website')
    expect(event.event_id).toBe(facebookConnectedLeadEventId(AGENCY))
    // Marker written so the next connection is a no-op.
    expect(h.state.tracked.filter((t) => t.event === 'meta_capi_lead_sent')).toHaveLength(1)
  })

  it('ML-2: the Lead goes to the campaign dataset (Social CRM Production) with hashed PII only', async () => {
    mockFetch()
    await POST(req(validBody, { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))
    await flushAfter()

    const capiCall = calls.find((c) => c.url.includes('/events?'))!
    expect(capiCall.url).toContain(`/${PIXEL_ID}/events`)

    const userData = leadEvents()[0].user_data as Record<string, unknown>
    // sha256 of the NORMALISED email (trimmed + lowercased) — never the raw address.
    const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
    expect(userData.em).toEqual([sha256('rep@example.com')])
    expect(userData.external_id).toEqual([sha256(String(USER))])
    expect(JSON.stringify(leadEvents()[0]).toLowerCase()).not.toContain('rep@example.com')
    expect(userData.client_user_agent).toBe('Mozilla/5.0')
    expect(userData.client_ip_address).toBe('203.0.113.9') // first hop of x-forwarded-for
  })

  it('ML-3: failed Facebook connection (leadgen subscription rejected) emits NO Lead', async () => {
    mockFetch({ subscribedOk: false })
    const r = await POST(req(validBody))
    await flushAfter()

    expect(r.status).toBe(502)
    expect(h.state.merged).toHaveLength(0) // nothing persisted
    expect(leadEvents()).toHaveLength(0)
  })

  it('ML-4: cross-tenant rejection (409) emits NO Lead', async () => {
    h.state.existingPage = { agency_id: 999 }
    mockFetch()
    const r = await POST(req(validBody))
    await flushAfter()

    expect(r.status).toBe(409)
    expect(leadEvents()).toHaveLength(0)
  })

  it('ML-5: reconnect / callback retry does NOT duplicate the Lead', async () => {
    mockFetch()
    await POST(req(validBody))
    await flushAfter()
    expect(leadEvents()).toHaveLength(1)

    // Marker now exists (as it would in analytics_events); replay the flow twice.
    h.state.leadMarker = { id: 1, event: 'meta_capi_lead_sent' }
    h.state.existingPage = { agency_id: AGENCY }

    await POST(req(validBody))
    await flushAfter()
    await POST(req(validBody))
    await flushAfter()

    expect(h.state.merged).toHaveLength(3) // all three connections persisted...
    expect(leadEvents()).toHaveLength(1) // ...but only one conversion counted
  })

  it('ML-6: a Meta API failure never breaks the Facebook connection', async () => {
    mockFetch({ capiOk: false })
    const r = await POST(req(validBody))
    await flushAfter()

    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true })
    expect(h.state.merged).toHaveLength(1) // connection persisted regardless
    // No marker written → the conversion is retried on the next successful connect
    // rather than being silently lost.
    expect(h.state.tracked.filter((t) => t.event === 'meta_capi_lead_sent')).toHaveLength(0)
  })

  it('ML-7: a thrown/timed-out Meta request never breaks the Facebook connection', async () => {
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, init })
      if (u.includes('/events?')) throw new Error('ECONNRESET')
      if (u.includes('subscribed_apps')) return res(200, { success: true, data: [] })
      return res(200, { data: [] })
    }) as unknown as typeof fetch

    const r = await POST(req(validBody))
    await expect(flushAfter()).resolves.toBeUndefined() // never rejects

    expect(r.status).toBe(200)
    expect(h.state.merged).toHaveLength(1)
    expect(h.state.tracked.filter((t) => t.event === 'meta_capi_lead_sent')).toHaveLength(0)
  })

  it('ML-8: OAuth start emits NO Lead', async () => {
    mockFetch()
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://getsocialcrm.com')
    const r = await OAUTH_START({
      url: 'https://getsocialcrm.com/api/auth/facebook?origin=settings',
    } as unknown as import('next/server').NextRequest)
    await flushAfter()

    expect(r.status).toBe(307) // redirect to the OAuth dialog
    expect(leadEvents()).toHaveLength(0)
  })

  it('ML-9: unconfigured CAPI is a silent no-op, not a failure', async () => {
    vi.stubEnv('META_CAPI_ACCESS_TOKEN', '')
    mockFetch()
    const r = await POST(req(validBody))
    await flushAfter()

    expect(r.status).toBe(200)
    expect(leadEvents()).toHaveLength(0)
    expect(h.state.tracked.filter((t) => t.event === 'meta_capi_lead_sent')).toHaveLength(0)
  })

  it('ML-10: an already-converted agency short-circuits before calling Meta at all', async () => {
    h.state.leadMarker = { id: 1, event: 'meta_capi_lead_sent' }
    mockFetch()
    await sendFacebookConnectedLeadOnce({ agencyId: AGENCY, userId: USER, email: 'rep@example.com' })

    expect(calls.filter((c) => c.url.includes('/events?'))).toHaveLength(0)
  })
})

describe('Meta Lead conversion — no other surface emits it', () => {
  /**
   * Structural guard covering "registration alone does not emit Lead", plus page
   * visits and onboarding. Rather than booting every surface, assert that the only
   * production caller of the conversion module is the Facebook connect route, and
   * that no client Pixel code can fire a `Lead`.
   */
  const root = path.resolve(__dirname, '..', '..')
  const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

  it('ML-11: registration / page-visit / onboarding Pixel code cannot emit Lead', () => {
    // The client Pixel event union has no 'Lead' member, so `trackPixelEvent('Lead')`
    // will not typecheck anywhere in the app.
    expect(read('lib/facebook/pixelEvents.ts')).not.toMatch(/'Lead'/)
    // Registration fires CompleteRegistration only.
    const registrationPixel = read('components/activation/RegistrationPixel.tsx')
    expect(registrationPixel).toContain('trackCompleteRegistration')
    expect(registrationPixel).not.toContain('Lead')
    // The base Pixel fires PageView only.
    expect(read('lib/facebook/MetaPixel.tsx')).not.toContain('Lead')
  })

  it('ML-12: the OAuth callback never emits Lead (it persists nothing but a cookie)', () => {
    const callback = read('app/api/auth/facebook/callback/route.ts')
    expect(callback).not.toContain('metaLeadConversion')
    expect(callback).not.toContain('sendFacebookConnectedLeadOnce')
  })

  it('ML-13: the connect route is the sole caller of the conversion module', () => {
    const callers = ['app/api/auth/facebook/connect/route.ts']
    expect(read(callers[0])).toContain('sendFacebookConnectedLeadOnce')
    // Nothing else in the tree imports it (verified by the audit; pinned here so a
    // future surface cannot quietly add a second emission point).
    const grep = execSync(
      `grep -rl "sendFacebookConnectedLeadOnce" --include="*.ts" --include="*.tsx" app components lib actions || true`,
      { cwd: root, encoding: 'utf8' },
    )
    const files = grep.split('\n').filter(Boolean).filter((f) => !f.includes('lib/facebook/metaLeadConversion.ts'))
    expect(files.sort()).toEqual(callers)
  })
})
