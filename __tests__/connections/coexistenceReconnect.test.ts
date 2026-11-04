/**
 * Reconnecting an existing WhatsApp Coexistence connection must never convert
 * it to Cloud API, register it (POST /register) or repeat the one-time
 * smb_app_data sync — whatever Meta's is_on_biz_app says, including an
 * explicit `false`. Leaving Coexistence is the customer's explicit choice.
 *
 * End to end through the Embedded Signup route with the REAL registration
 * module (PR #189 fail-closed guard included). Mocked Graph only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { existing: null as { agency_id: number; onboarding_type?: string | null } | null, merged: [] as Record<string, unknown>[], inserted: [] as Record<string, unknown>[] }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.whereRaw = () => qb
  qb.first = async () => state.existing
  qb.insert = (obj: Record<string, unknown>) => {
    state.inserted.push(obj)
    return qb
  }
  qb.onConflict = () => qb
  qb.merge = (obj: Record<string, unknown>) => {
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

const AGENCY = 69
type BizApp = 'true' | 'false' | 'http_500' | 'missing'
function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}
function mockGraph(bizApp: BizApp, phoneStatus: 'PENDING' | 'CONNECTED' = 'PENDING') {
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = String(init?.method || 'GET').toUpperCase()
    if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok_abc' })
    if (u.includes('fields=is_on_biz_app')) {
      if (bizApp === 'http_500') return res(500, { error: { code: 2 } })
      if (bizApp === 'missing') return res(200, { platform_type: 'CLOUD_API' })
      return res(200, { is_on_biz_app: bizApp === 'true', platform_type: 'CLOUD_API' })
    }
    if (u.includes('fields=status')) return res(200, { status: phoneStatus, platform_type: 'CLOUD_API' })
    if (u.includes('subscribed_apps')) return res(200, { success: true })
    if (u.includes('/register') && method === 'POST') return res(200, { success: true })
    if (u.includes('/smb_app_data')) return res(200, { messaging_product: 'whatsapp', request_id: 'req_1' })
    return res(200, {})
  }) as unknown as typeof fetch
}
const calls = (match: (u: string, method: string) => boolean) =>
  vi.mocked(global.fetch).mock.calls.filter(([url, init]) => match(String(url), String((init as RequestInit | undefined)?.method || 'GET').toUpperCase()))
const registerCalls = () => calls((u, m) => u.includes('/register') && m === 'POST')
const smbSyncCalls = () => calls((u) => u.includes('/smb_app_data'))
const bizAppLookups = () => calls((u) => u.includes('fields=is_on_biz_app'))
const req = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest
const finish = (onboardingType: 'cloud_api' | 'coexistence' = 'cloud_api') => req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1', onboardingType })
const persisted = () => [...h.state.inserted, ...h.state.merged].map((r) => r.onboarding_type)

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  h.state.existing = null
  h.state.merged = []
  h.state.inserted = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.mocked(getUser).mockResolvedValue({ id: 298, agencyId: AGENCY, role: 'ADMIN', email: 'x@example.com' } as never)
})
afterEach(() => {
  warn.mockRestore()
  vi.mocked(console.error).mockRestore?.()
  vi.mocked(console.log).mockRestore?.()
})

describe('existing same-agency Coexistence connection, reconnect with a plain FINISH', () => {
  beforeEach(() => {
    h.state.existing = { agency_id: AGENCY, onboarding_type: 'coexistence' }
  })

  it.each(['http_500', 'missing'] as const)('1 · Meta status unknown (%s): stays coexistence, no /register, no re-sync, pending', async (bizApp) => {
    mockGraph(bizApp)
    const r = await POST(finish())
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'coexistence_pending' })
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
    expect(smbSyncCalls()).toHaveLength(0)
  })

  it('2 · Meta explicitly says is_on_biz_app=false: stays coexistence, NEVER /register, no re-sync, conflict diagnostic', async () => {
    mockGraph('false')
    const r = await POST(finish())
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'coexistence_pending' })
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
    expect(smbSyncCalls()).toHaveLength(0)
    const diag = warn.mock.calls.find(([msg]) => String(msg).includes('conflicts with the stored connection'))
    expect(diag).toBeTruthy()
    expect(JSON.stringify(diag)).not.toContain('tok_abc')
  })

  it('2b · even an explicit false with a CONNECTED number is reported ready without any /register', async () => {
    mockGraph('false', 'CONNECTED')
    const r = await POST(finish())
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: true })
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
  })

  it('3 · Meta says is_on_biz_app=true: stays coexistence, no /register, the one-time sync is not repeated', async () => {
    mockGraph('true')
    const r = await POST(finish())
    expect(await r.json()).toMatchObject({ ok: true, messagingReady: false, reason: 'coexistence_pending' })
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
    expect(smbSyncCalls()).toHaveLength(0)
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('conflicts with the stored connection'))).toBe(false)
  })
})

describe('4 · existing Cloud API connection (unchanged)', () => {
  beforeEach(() => {
    h.state.existing = { agency_id: AGENCY, onboarding_type: 'cloud_api' }
  })

  it('explicit is_on_biz_app=false: stays cloud_api and registers as before', async () => {
    mockGraph('false')
    expect(await (await POST(finish())).json()).toMatchObject({ ok: true, messagingReady: true })
    expect(persisted()).toEqual(['cloud_api', 'cloud_api'])
    expect(registerCalls()).toHaveLength(1)
  })

  it('unknown status: stays cloud_api and is not registered (PR #189)', async () => {
    mockGraph('http_500')
    expect(await (await POST(finish())).json()).toMatchObject({ ok: true, messagingReady: false, reason: 'biz_app_status_unknown' })
    expect(persisted()).toEqual(['cloud_api', 'cloud_api'])
    expect(registerCalls()).toHaveLength(0)
  })

  it('is_on_biz_app=true: becomes coexistence and is not registered (as before)', async () => {
    mockGraph('true')
    await POST(finish())
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
  })
})

describe('5 · new connection (unchanged)', () => {
  it('unknown status + plain FINISH: cloud_api, never /register (PR #189)', async () => {
    mockGraph('http_500')
    expect(await (await POST(finish())).json()).toMatchObject({ ok: true, messagingReady: false, reason: 'biz_app_status_unknown' })
    expect(persisted()).toEqual(['cloud_api', 'cloud_api'])
    expect(registerCalls()).toHaveLength(0)
  })

  it('explicit is_on_biz_app=false: Cloud API onboarding registers as before', async () => {
    mockGraph('false')
    expect(await (await POST(finish())).json()).toMatchObject({ ok: true, messagingReady: true })
    expect(registerCalls()).toHaveLength(1)
    expect(smbSyncCalls()).toHaveLength(0)
  })

  it('Coexistence event: coexistence, no /register, the one-time sync runs once', async () => {
    mockGraph('true')
    await POST(finish('coexistence'))
    expect(persisted()).toEqual(['coexistence', 'coexistence'])
    expect(registerCalls()).toHaveLength(0)
    expect(smbSyncCalls().length).toBeGreaterThanOrEqual(1)
  })
})

describe('6 · cross-agency connection (unchanged)', () => {
  it.each(['coexistence', 'cloud_api'])('a %s number owned by another agency: 409, nothing saved, no Graph phone calls, no /register', async (onboarding_type) => {
    h.state.existing = { agency_id: 999, onboarding_type }
    mockGraph('false')
    const r = await POST(finish())
    expect(r.status).toBe(409)
    expect(h.state.merged).toHaveLength(0)
    expect(h.state.inserted).toHaveLength(0)
    expect(registerCalls()).toHaveLength(0)
    expect(bizAppLookups()).toHaveLength(0)
  })
})
