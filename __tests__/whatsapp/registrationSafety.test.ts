import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'

const originalFetch = global.fetch

function jsonRes(ok: boolean, body: unknown, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 400),
    json: async () => body,
  }
}

function mockGraph(opts: {
  status?: string
  isOnBizApp?: boolean
  registerOk?: boolean
  /** How the is_on_biz_app lookup misbehaves; omitted = answers normally. */
  bizAppLookup?: 'http_500' | 'missing_field' | 'throws' | 'bad_json'
}) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = String(init?.method || 'GET').toUpperCase()
    if (u.includes('/register') && method === 'POST') {
      const ok = opts.registerOk !== false
      return jsonRes(ok, ok ? { success: true } : { error: { message: 'denied' } })
    }
    if (u.includes('fields=is_on_biz_app')) {
      if (opts.bizAppLookup === 'http_500') return jsonRes(false, { error: { code: 2 } }, 500)
      if (opts.bizAppLookup === 'missing_field') return jsonRes(true, { platform_type: 'CLOUD_API' })
      if (opts.bizAppLookup === 'throws') throw new Error('network down')
      if (opts.bizAppLookup === 'bad_json') return { ok: true, status: 200, json: async () => { throw new Error('bad json') } }
      return jsonRes(true, { is_on_biz_app: opts.isOnBizApp === true, platform_type: 'CLOUD_API' })
    }
    if (u.includes('fields=status')) {
      return jsonRes(true, { status: opts.status ?? 'PENDING', platform_type: 'CLOUD_API' })
    }
    return jsonRes(true, {})
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function registerCalls(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.filter(([url, init]) => {
    const u = String(url)
    const method = String((init as RequestInit | undefined)?.method || 'GET').toUpperCase()
    return u.includes('/register') && method === 'POST'
  })
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('ensureMessagingReady — /register safety', () => {
  it('never POSTs /register when is_on_biz_app is true, even without skipRegistration', async () => {
    const fn = mockGraph({ status: 'PENDING', isOnBizApp: true })
    const result = await ensureMessagingReady('PHONE', 'TOKEN')
    expect(registerCalls(fn)).toHaveLength(0)
    expect(result).toMatchObject({ ready: false, reason: 'coexistence_pending' })
  })

  it('skips /register for Coexistence onboarding (skipRegistration)', async () => {
    const fn = mockGraph({ status: 'PENDING', isOnBizApp: false })
    const result = await ensureMessagingReady('PHONE', 'TOKEN', { skipRegistration: true })
    expect(registerCalls(fn)).toHaveLength(0)
    expect(result.reason).toBe('coexistence_pending')
  })

  it('still POSTs /register for Cloud API numbers that are not on the Business app', async () => {
    const fn = mockGraph({ status: 'PENDING', isOnBizApp: false, registerOk: true })
    const result = await ensureMessagingReady('PHONE', 'TOKEN')
    expect(registerCalls(fn)).toHaveLength(1)
    expect(String(registerCalls(fn)[0][0])).toContain('/PHONE/register')
    expect(result).toMatchObject({ ready: true, status: 'CONNECTED' })
  })

  it('does not POST /register when the number is already CONNECTED', async () => {
    const fn = mockGraph({ status: 'CONNECTED', isOnBizApp: false })
    const result = await ensureMessagingReady('PHONE', 'TOKEN')
    expect(registerCalls(fn)).toHaveLength(0)
    expect(result).toMatchObject({ ready: true, status: 'CONNECTED' })
  })
})

describe('ensureMessagingReady — fails closed when Business app status is unknown', () => {
  // A Business app number reaching /register would be claimed for Cloud API:
  // the forced migration Coexistence exists to avoid. An unanswered lookup is
  // therefore treated as "might be on the Business app".
  it.each(['http_500', 'missing_field', 'throws', 'bad_json'] as const)(
    'never POSTs /register when the is_on_biz_app lookup is %s',
    async (bizAppLookup) => {
      const fn = mockGraph({ status: 'PENDING', bizAppLookup })
      const result = await ensureMessagingReady('PHONE', 'TOKEN')
      expect(registerCalls(fn)).toHaveLength(0)
      expect(result).toMatchObject({ ready: false, status: 'PENDING', reason: 'biz_app_status_unknown' })
    },
  )

  it('an explicit is_on_biz_app=false still registers a Cloud API number (unchanged)', async () => {
    const fn = mockGraph({ status: 'PENDING', isOnBizApp: false })
    const result = await ensureMessagingReady('PHONE', 'TOKEN')
    expect(registerCalls(fn)).toHaveLength(1)
    expect(result).toMatchObject({ ready: true })
  })

  it('an already CONNECTED number needs no lookup and is ready even if the lookup would fail', async () => {
    const fn = mockGraph({ status: 'CONNECTED', bizAppLookup: 'http_500' })
    const result = await ensureMessagingReady('PHONE', 'TOKEN')
    expect(registerCalls(fn)).toHaveLength(0)
    expect(result).toMatchObject({ ready: true, status: 'CONNECTED' })
  })
})
