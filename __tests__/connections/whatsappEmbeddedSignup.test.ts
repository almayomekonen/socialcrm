/**
 * Regression tests for the WhatsApp Embedded Signup route — the Oren Dasta
 * incident (2026-07-21): subscribed_apps failed 400, yet a whatsapp_connections
 * row was persisted and the UI could claim "connected".
 *
 * Strategy: unit-level. The DB-backed integration harness cannot run in this
 * environment (the `clients` base table is not in the knex migration chain), so
 * we mock `@/config/db`, `getUser`, readiness, analytics, and global fetch, and
 * assert the route's control flow: WHEN does it persist, and WHAT does it return.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    existing: null as { agency_id: number; onboarding_type?: string | null } | null,
    merged: [] as unknown[],
    inserted: [] as unknown[],
  }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.whereRaw = () => qb
  qb.first = async () => state.existing
  qb.insert = (obj: unknown) => {
    state.inserted.push(obj)
    return qb
  }
  qb.onConflict = () => qb
  qb.merge = async (obj: unknown) => {
    state.merged.push(obj)
    return [1]
  }
  const db = Object.assign((_table: string) => qb, { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(),
  trackOncePerAgency: vi.fn(),
  trackFirstRealLeadOnce: vi.fn(),
}))
vi.mock('@/lib/whatsapp/registration', () => ({
  ensureMessagingReady: vi.fn(async () => ({ ready: true, status: 'CONNECTED' })),
}))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'
import { getUser } from '@/db/auth'
import { trackOncePerAgency } from '@/lib/analytics/track'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'

const AGENCY = 69
const USER = 298

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** Route fetch calls: token exchange, phone metadata, then subscribed_apps. */
function mockFetch({ subscribedOk, isOnBizApp = false }: { subscribedOk: boolean; isOnBizApp?: boolean }) {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok_abc' })
    if (u.includes('fields=is_on_biz_app')) return res(200, { is_on_biz_app: isOnBizApp, platform_type: 'CLOUD_API' })
    if (u.includes('subscribed_apps')) return subscribedOk ? res(200, { success: true }) : res(400, { error: { message: 'Object does not exist', code: 100 } })
    if (u.includes('/smb_app_data')) return res(200, { messaging_product: 'whatsapp', request_id: 'req_1' })
    return res(200, {})
  }) as unknown as typeof fetch
}

function req(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  h.state.existing = null
  h.state.merged = []
  h.state.inserted = []
  // Phase 2 gave the Embedded Signup route an admin boundary. This suite covers
  // the PERSISTENCE GATE, so the fixture now represents a caller who is permitted
  // to reach it; authorization itself is covered separately in
  // __tests__/connections/phase2AuthorizationBoundaries.test.ts.
  vi.mocked(getUser).mockResolvedValue({ id: USER, agencyId: AGENCY, role: 'ADMIN', email: 'x@example.com' } as never)
  vi.mocked(ensureMessagingReady).mockClear()
  vi.mocked(ensureMessagingReady).mockResolvedValue({ ready: true, status: 'CONNECTED' })
  vi.mocked(trackOncePerAgency).mockClear()
})

/** Calls to the shared once-per-agency tracker for one measurement event. */
function analyticsCalls(event: 'whatsapp_signup_completed' | 'whatsapp_phone_discovered') {
  return vi.mocked(trackOncePerAgency).mock.calls.filter((call) => call[1] === event)
}

describe('WhatsApp Embedded Signup — persistence gate', () => {
  it('WA-1: subscribed_apps succeeds → connection persisted, ok:true', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true })
    expect(h.state.merged).toHaveLength(1) // persisted
  })

  it('WA-2 (OREN REGRESSION): subscribed_apps returns 400 → NO persist, structured reason', async () => {
    mockFetch({ subscribedOk: false })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(502)
    const body = await r.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('SUBSCRIBED_APPS_FAILED')
    // THE FIX: no operational connection row is written on subscription failure.
    expect(h.state.merged).toHaveLength(0)
  })

  it('WA-4: missing WABA → no persist, WABA_NOT_FOUND', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ code: 'c', phoneNumberId: 'P1' })) // no wabaId
    expect(r.status).toBe(400)
    expect((await r.json()).reason).toBe('WABA_NOT_FOUND')
    expect(h.state.merged).toHaveLength(0)
  })

  it('invalid WABA (empty string) → no persist, WABA_NOT_FOUND', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ code: 'c', wabaId: '', phoneNumberId: 'P1' }))
    expect(r.status).toBe(400)
    expect((await r.json()).reason).toBe('WABA_NOT_FOUND')
    expect(h.state.merged).toHaveLength(0)
  })

  it('missing OAuth code → 400, no persist, no Graph calls', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(400)
    expect(h.state.merged).toHaveLength(0)
  })

  it('token exchange failed → TOKEN_EXCHANGE_FAILED, no persist', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('oauth/access_token')) return res(400, { error: { message: 'Invalid code' } })
      return res(200, {})
    }) as unknown as typeof fetch
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(400)
    expect((await r.json()).reason).toBe('TOKEN_EXCHANGE_FAILED')
    expect(h.state.merged).toHaveLength(0)
    const urls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('subscribed_apps'))).toBe(false)
  })

  it('phone registration not ready → still persist (subscribed), messagingReady false', async () => {
    mockFetch({ subscribedOk: true })
    vi.mocked(ensureMessagingReady).mockResolvedValue({ ready: false, reason: 'registration_required' })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'registration_required' })
    expect(h.state.merged).toHaveLength(1)
  })

  it('WA-7: phone_number_id owned by another agency → 409, no reassignment', async () => {
    h.state.existing = { agency_id: 999 } // different agency owns this number
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(409)
    expect((await r.json()).reason).toBe('RESOURCE_CLAIMED')
    expect(h.state.merged).toHaveLength(0) // ownership NOT transferred
  })

  it('WA-6: same agency reconnecting the same number → allowed, persists', async () => {
    h.state.existing = { agency_id: AGENCY } // same agency owns it
    mockFetch({ subscribedOk: true })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(r.status).toBe(200)
    expect(h.state.merged).toHaveLength(1)
  })

  it('Graph is_on_biz_app=true forces Coexistence even when the browser sent cloud_api', async () => {
    mockFetch({ subscribedOk: true, isOnBizApp: true })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(r.status).toBe(200)
    expect(h.state.inserted[0]).toMatchObject({ onboarding_type: 'coexistence' })
    expect(vi.mocked(ensureMessagingReady).mock.calls[0][2]).toEqual({ skipRegistration: true })
    const urls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/smb_app_data'))).toBe(true)
  })

  it('Coexistence onboarding skips registration and persists onboarding_type', async () => {
    mockFetch({ subscribedOk: true, isOnBizApp: false })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'coexistence' }))
    expect(r.status).toBe(200)
    expect(h.state.inserted[0]).toMatchObject({ onboarding_type: 'coexistence' })
    expect(vi.mocked(ensureMessagingReady).mock.calls[0][2]).toEqual({ skipRegistration: true })
  })

  it('Cloud API onboarding still registers and does not request smb_app_data', async () => {
    mockFetch({ subscribedOk: true, isOnBizApp: false })
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(r.status).toBe(200)
    expect(h.state.inserted[0]).toMatchObject({ onboarding_type: 'cloud_api' })
    expect(vi.mocked(ensureMessagingReady).mock.calls[0][2]).toEqual({ skipRegistration: false })
    const urls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/smb_app_data'))).toBe(false)
  })

  it('Coexistence reconnect does not re-request the one-shot smb_app_data sync', async () => {
    h.state.existing = { agency_id: AGENCY, onboarding_type: 'coexistence' }
    mockFetch({ subscribedOk: true, isOnBizApp: true })
    await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    const urls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/smb_app_data'))).toBe(false)
    expect(vi.mocked(ensureMessagingReady).mock.calls[0][2]).toEqual({ skipRegistration: true })
  })

  it('emits signup completion and confirmed-phone events once after a new connection is persisted', async () => {
    mockFetch({ subscribedOk: true })

    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))

    expect(r.status).toBe(200)
    expect(h.state.merged).toHaveLength(1)
    expect(analyticsCalls('whatsapp_signup_completed')).toEqual([
      [AGENCY, 'whatsapp_signup_completed', USER, { onboardingType: 'cloud_api' }],
    ])
    expect(analyticsCalls('whatsapp_phone_discovered')).toEqual([
      [AGENCY, 'whatsapp_phone_discovered', USER, { onboardingType: 'cloud_api' }],
    ])
  })

  it('does not emit either event for a failed or abandoned signup', async () => {
    mockFetch({ subscribedOk: false })
    const failed = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(failed.status).toBe(502)

    const abandoned = await POST(req({ wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(abandoned.status).toBe(400)

    expect(analyticsCalls('whatsapp_signup_completed')).toHaveLength(0)
    expect(analyticsCalls('whatsapp_phone_discovered')).toHaveLength(0)
  })

  it('does not emit a phone-discovered event when no confirmed phone can be resolved', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok_abc' })
      if (u.includes('/phone_numbers')) return res(200, { data: [] })
      return res(200, {})
    }) as unknown as typeof fetch

    const r = await POST(req({ code: 'c', wabaId: 'W1' }))

    expect(r.status).toBe(400)
    expect((await r.json()).reason).toBe('PHONE_NOT_FOUND')
    expect(h.state.merged).toHaveLength(0)
    expect(analyticsCalls('whatsapp_signup_completed')).toHaveLength(0)
    expect(analyticsCalls('whatsapp_phone_discovered')).toHaveLength(0)
  })

  it('does not duplicate either event when a success callback is retried for an existing connection', async () => {
    mockFetch({ subscribedOk: true })
    const first = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(first.status).toBe(200)

    h.state.existing = { agency_id: AGENCY }
    const replay = await POST(req({ code: 'c2', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(replay.status).toBe(200)

    expect(analyticsCalls('whatsapp_signup_completed')).toHaveLength(1)
    expect(analyticsCalls('whatsapp_phone_discovered')).toHaveLength(1)
  })
})
