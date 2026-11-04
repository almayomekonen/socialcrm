/**
 * End to end through the Embedded Signup route with the REAL registration
 * module: a number Meta may still have on the WhatsApp Business app is never
 * claimed for Cloud API because a metadata lookup failed.
 *
 * Before this fix both `is_on_biz_app` lookups failed open (`isOnBizApp:
 * false`), so a Business app number whose flow ended with a plain FINISH event
 * and whose lookup timed out reached POST /register — a forced migration.
 * Mocked Graph only; no real Meta call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { existing: null as { agency_id: number; onboarding_type?: string | null } | null, merged: [] as unknown[], inserted: [] as unknown[] }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.whereRaw = () => qb
  qb.first = async () => state.existing
  qb.insert = (obj: unknown) => {
    state.inserted.push(obj)
    return qb
  }
  qb.onConflict = () => qb
  qb.merge = (obj: unknown) => {
    state.merged.push(obj)
    return { where: () => ({ returning: async () => [{ id: 1 }] }) }
  }
  const db = Object.assign((_table: string) => qb, { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackOncePerAgency: vi.fn(), trackFirstRealLeadOnce: vi.fn() }))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'
import { getUser } from '@/db/auth'

type Lookup = 'true' | 'false' | 'http_500' | 'throws'
function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}
function mockGraph(bizApp: Lookup) {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = String(init?.method || 'GET').toUpperCase()
    if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok_abc' })
    if (u.includes('fields=is_on_biz_app')) {
      if (bizApp === 'http_500') return res(500, { error: { code: 2 } })
      if (bizApp === 'throws') throw new Error('timeout')
      return res(200, { is_on_biz_app: bizApp === 'true', platform_type: 'CLOUD_API' })
    }
    if (u.includes('fields=status')) return res(200, { status: 'PENDING', platform_type: 'CLOUD_API' })
    if (u.includes('subscribed_apps')) return res(200, { success: true })
    if (u.includes('/register') && method === 'POST') return res(200, { success: true })
    if (u.includes('/smb_app_data')) return res(200, { messaging_product: 'whatsapp', request_id: 'req_1' })
    return res(200, {})
  }) as unknown as typeof fetch
}
const registerCalls = () =>
  vi.mocked(global.fetch).mock.calls.filter(([url, init]) => String(url).includes('/register') && String((init as RequestInit | undefined)?.method || 'GET').toUpperCase() === 'POST')
const req = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest

beforeEach(() => {
  h.state.existing = null
  h.state.merged = []
  h.state.inserted = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(getUser).mockResolvedValue({ id: 298, agencyId: 69, role: 'ADMIN', email: 'x@example.com' } as never)
})

describe('Embedded Signup never registers a number whose Business app status is unknown', () => {
  it.each(['http_500', 'throws'] as const)('lookup %s + plain FINISH (cloud_api): saved, NOT registered, honest not-ready', async (lookup) => {
    mockGraph(lookup)
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'biz_app_status_unknown' })
    expect(registerCalls()).toHaveLength(0)
    expect(h.state.merged).toHaveLength(1) // onboarding is not blocked
  })

  it('a Coexistence completion event skips registration even when the lookup fails (unchanged)', async () => {
    mockGraph('http_500')
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'coexistence' }))
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'coexistence_pending' })
    expect(registerCalls()).toHaveLength(0)
  })

  it('Graph is_on_biz_app=true: Coexistence, never registered, even with a cloud_api browser hint (unchanged)', async () => {
    mockGraph('true')
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false })
    expect(registerCalls()).toHaveLength(0)
  })

  it('a known Cloud API number (is_on_biz_app=false) is still registered (unchanged)', async () => {
    mockGraph('false')
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: true })
    expect(registerCalls()).toHaveLength(1)
  })

  it('an existing connection in another agency is untouched and never registered', async () => {
    h.state.existing = { agency_id: 999, onboarding_type: 'coexistence' }
    mockGraph('http_500')
    const r = await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'cloud_api' }))
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(h.state.merged).toHaveLength(0)
    expect(registerCalls()).toHaveLength(0)
  })
})
