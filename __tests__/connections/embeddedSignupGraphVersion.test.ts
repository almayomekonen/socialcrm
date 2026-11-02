/**
 * The Embedded Signup route's OAuth code exchange and subscribed_apps call use
 * the flow's supported, explicitly configured Graph version
 * (COEXISTENCE_GRAPH_VERSION, default v25.0) — never the expired app-wide v19.0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.first = async () => null
  qb.insert = () => qb
  qb.onConflict = () => qb
  qb.merge = async () => [1]
  return { db: Object.assign(() => qb, { raw: async () => ({}) }) }
})
vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn(async () => ({ id: 1, agencyId: 69, role: 'ADMIN', email: 'x@example.com' })) }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackOncePerAgency: vi.fn(), trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/lib/whatsapp/registration', () => ({ ensureMessagingReady: vi.fn(async () => ({ ready: true, status: 'CONNECTED' })) }))

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
const req = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok' })
    if (u.includes('fields=is_on_biz_app')) return res(200, { is_on_biz_app: false })
    return res(200, { success: true })
  }) as never
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const urlsFor = (part: string) => vi.mocked(global.fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.includes(part))

describe('Embedded Signup Graph version', () => {
  it('default: OAuth exchange and subscribed_apps both at v25.0, never v19.0', async () => {
    vi.resetModules()
    const { POST } = await import('@/app/api/whatsapp/embedded-signup/route')
    await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    const oauth = urlsFor('oauth/access_token')
    const subscribe = urlsFor('/subscribed_apps')
    expect(oauth).toHaveLength(1)
    expect(subscribe).toHaveLength(1)
    expect(oauth[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v25\.0\/oauth\/access_token\?/)
    expect(subscribe[0]).toBe('https://graph.facebook.com/v25.0/W1/subscribed_apps')
    expect([...oauth, ...subscribe].some((u) => u.includes('/v19.0/'))).toBe(false)
  })

  it('META_COEXISTENCE_GRAPH_VERSION configures both calls consistently', async () => {
    vi.stubEnv('META_COEXISTENCE_GRAPH_VERSION', 'v26.0')
    vi.resetModules()
    const { POST } = await import('@/app/api/whatsapp/embedded-signup/route')
    await POST(req({ code: 'c', wabaId: 'W1', phoneNumberId: 'P1' }))
    expect(urlsFor('oauth/access_token')[0]).toContain('/v26.0/oauth/access_token')
    expect(urlsFor('/subscribed_apps')[0]).toBe('https://graph.facebook.com/v26.0/W1/subscribed_apps')
  })
})
