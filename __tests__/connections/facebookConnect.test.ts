/**
 * Regression tests for the Facebook connect route (Page persistence).
 *
 * Confirms two invariants:
 *  - the correct EXISTING behavior is preserved: a Page is only saved AFTER a
 *    successful leadgen subscription (FB-8);
 *  - the NEW cross-tenant guard: a Page already owned by another agency cannot
 *    be silently claimed (FB-9).
 *
 * Unit-level (mocked db/fetch/auth) — see whatsappEmbeddedSignup.test.ts for why
 * the DB harness is unavailable here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { existing: null as { agency_id: number } | null, merged: [] as unknown[] }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.first = async () => state.existing
  qb.insert = () => qb
  qb.onConflict = () => qb
  qb.merge = async (obj: unknown) => {
    state.merged.push(obj)
    return [1]
  }
  const db = Object.assign((_table: string) => qb, { raw: async () => ({}) })
  return { state, db }
})

const pendingState = vi.hoisted(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
  return {
    value: null as null | { pages: { id: string; name: string; token: string }[]; grantedScopes: string[] },
  }
})
const defaultPending = () => ({ pages: [{ id: 'PG1', name: 'My Page', token: 'ptok' }], grantedScopes: [] as string[] })

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/lib/facebook/pendingPages', () => ({
  PENDING_PAGES_COOKIE: 'fb_pages',
  // The server-side cookie the OAuth callback wrote. Tests control it directly.
  readPendingPages: vi.fn(async () => pendingState.value),
  pendingPageToken: (pending: { pages: { id: string; name: string; token: string }[] } | null, pageId: string) => {
    const p = pending?.pages.find((x) => x.id === pageId)
    return p ? { name: p.name, token: p.token } : null
  },
}))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/lib/events/emit', () => ({ emitLifecycleEvent: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
}))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: (cb: () => void) => void cb }
})

import { POST } from '@/app/api/auth/facebook/connect/route'
import { getUser } from '@/db/auth'
import { FACEBOOK_PAGE_WEBHOOK_FIELDS } from '@/lib/facebook/pageWebhookFields'

const AGENCY = 69

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function mockFetch({ subscribedOk }: { subscribedOk: boolean }) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('subscribed_apps') && (!init?.method || init.method === 'POST')) {
      return subscribedOk ? res(200, { success: true, data: [] }) : res(400, { error: { message: 'no perm' } })
    }
    if (u.includes('subscribed_apps')) return res(200, { data: [] })
    return res(200, { data: [] })
  }) as unknown as typeof fetch
}

function req(body: unknown) {
  return {
    json: async () => body,
    // Attribution signals read by the Meta Lead conversion (see
    // metaLeadConversion.test.ts); absent here, which the route tolerates.
    headers: { get: () => null },
  } as unknown as import('next/server').NextRequest
}

const validBody = { pageId: 'PG1', pageName: 'My Page', pageAccessToken: 'ptok' }

beforeEach(() => {
  pendingState.value = defaultPending()
  h.state.existing = null
  h.state.merged = []
  // Phase 2 gave the integration routes an admin boundary. This suite covers
  // connect/disconnect MECHANICS, so the fixture now represents a caller who is
  // permitted to reach them; authorization itself is covered separately in
  // __tests__/connections/phase2AuthorizationBoundaries.test.ts.
  vi.mocked(getUser).mockResolvedValue({ id: 1, agencyId: AGENCY, role: 'ADMIN', email: 'x@example.com' } as never)
})

describe('Facebook connect — persistence & tenancy', () => {
  it('FB-1: subscription succeeds → Page persisted, ok:true', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req(validBody))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true })
    expect(h.state.merged).toHaveLength(1)
  })

  it('FB-fields: subscribe POST body is leadgen,feed (Lead Ads + Comments)', async () => {
    mockFetch({ subscribedOk: true })
    await POST(req(validBody))
    const calls = vi.mocked(fetch).mock.calls
    const subscribeCall = calls.find(
      ([url, init]) => String(url).includes('subscribed_apps') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(subscribeCall).toBeTruthy()
    const body = String((subscribeCall![1] as RequestInit).body)
    expect(body.includes('leadgen') && body.includes('feed')).toBe(true)
    expect(FACEBOOK_PAGE_WEBHOOK_FIELDS).toBe('leadgen,feed')
  })

  it('FB-8: leadgen subscription fails → NO Page persisted (correct behavior preserved)', async () => {
    mockFetch({ subscribedOk: false })
    const r = await POST(req(validBody))
    expect(r.status).toBe(502)
    expect((await r.json()).error).toBe('subscription_failed')
    expect(h.state.merged).toHaveLength(0)
  })

  it('FB-9: Page owned by another agency → 409, no reassignment, no other-agency leak', async () => {
    h.state.existing = { agency_id: 999 }
    mockFetch({ subscribedOk: true })
    const r = await POST(req(validBody))
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toBe('resource_claimed')
    expect(body.reason).toBe('RESOURCE_CLAIMED')
    expect(JSON.stringify(body)).not.toContain('999') // owning agency id never leaked
    expect(h.state.merged).toHaveLength(0)
  })

  it('FB (same-agency reconnect): existing Page owned by same agency → allowed', async () => {
    h.state.existing = { agency_id: AGENCY }
    mockFetch({ subscribedOk: true })
    const r = await POST(req(validBody))
    expect(r.status).toBe(200)
    expect(h.state.merged).toHaveLength(1)
  })
})

describe('Facebook connect — token hygiene (App Review hardening)', () => {
  it('FB-T1: a token in the request body is ignored; the server-side token is used and stored SEALED', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ pageId: 'PG1', pageName: 'Forged', pageAccessToken: 'attacker-token' }))
    expect(r.status).toBe(200)

    const subscribe = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).includes('subscribed_apps') && (init as RequestInit)?.method === 'POST')
    const form = new URLSearchParams(String((subscribe![1] as RequestInit).body))
    expect(form.get('access_token')).toBe('ptok')

    const saved = h.state.merged[0] as { page_access_token: string; page_name: string }
    expect(saved.page_access_token.startsWith('scm1.')).toBe(true)
    expect(saved.page_access_token).not.toContain('ptok')
    expect(saved.page_access_token).not.toContain('attacker-token')
    expect(saved.page_name).toBe('My Page')

    const { resolvePageAccessToken } = await import('@/lib/facebook/pageToken')
    expect(resolvePageAccessToken(saved.page_access_token)).toBe('ptok')
  })

  it('FB-T2: no server-side selection (cookie missing/expired/foreign) → 400 selection_expired, nothing subscribed or saved', async () => {
    pendingState.value = null
    mockFetch({ subscribedOk: true })
    const r = await POST(req(validBody))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('selection_expired')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(h.state.merged).toHaveLength(0)
  })

  it('FB-T3: a Page id that is not in the server-side selection is refused', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ pageId: 'SOMEONE-ELSES-PAGE' }))
    expect(r.status).toBe(400)
    expect(h.state.merged).toHaveLength(0)
  })

  it('FB-T4: Messenger fields are subscribed only when pages_messaging was granted AND Messenger is rolled out', async () => {
    const subscribeBody = () => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([url, init]) => String(url).includes('subscribed_apps') && (init as RequestInit)?.method === 'POST')
      return new URLSearchParams(String((call![1] as RequestInit).body)).get('subscribed_fields')
    }

    pendingState.value = { ...defaultPending(), grantedScopes: ['pages_messaging'] }
    mockFetch({ subscribedOk: true })
    await POST(req(validBody))
    expect(subscribeBody()).toBe('leadgen,feed')

    vi.stubEnv('FACEBOOK_MESSENGER_ENABLED', '1')
    vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', String(AGENCY))
    mockFetch({ subscribedOk: true })
    await POST(req(validBody))
    expect(subscribeBody()).toBe('leadgen,feed,messages,message_echoes,message_deliveries,message_reads,messaging_postbacks,messaging_referrals,message_reactions')

    pendingState.value = defaultPending()
    mockFetch({ subscribedOk: true })
    await POST(req(validBody))
    expect(subscribeBody()).toBe('leadgen,feed')
    vi.unstubAllEnvs()
  })
})
