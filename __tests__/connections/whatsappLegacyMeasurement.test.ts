import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnalyticsCall = {
  agencyId: number
  event: string
  userId: number
  props: Record<string, unknown>
}

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BASE_URL = 'https://app.test'

  const state = {
    cookies: {} as Record<string, string>,
    existing: null as { agency_id: number } | null,
    merged: [] as Record<string, unknown>[],
    insertError: false,
    emitted: [] as AnalyticsCall[],
  }

  const db = (_table: string) => {
    const query: Record<string, unknown> = {}
    query.where = () => query
    query.first = async () => state.existing
    query.insert = () => query
    query.onConflict = () => query
    query.merge = async (row: Record<string, unknown>) => {
      if (state.insertError) throw new Error('insert failed')
      state.merged.push(row)
      return [1]
    }
    return query
  }

  const trackOncePerAgency = vi.fn(async (agencyId: number, event: string, userId: number, props: Record<string, unknown>) => {
    if (!state.emitted.some((row) => row.agencyId === agencyId && row.event === event)) {
      state.emitted.push({ agencyId, event, userId, props })
    }
  })

  return { state, db, trackOncePerAgency }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }))
/**
 * Both legacy routes sit behind `requireAgencyAdmin`, which resolves identity
 * through `requireUser` — not `getUser`. The real boundary is left in place and
 * only its identity source is mocked, so these tests still execute the genuine
 * authorization path rather than bypassing it.
 */
vi.mock('@/lib/requireUser', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/requireUser')>()
  return { ...actual, requireUser: vi.fn() }
})
vi.mock('@/lib/whatsapp/resolveWaba', () => ({ resolveWabaIdsFromToken: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackOncePerAgency: h.trackOncePerAgency }))
vi.mock('@/lib/events/emit', () => ({ emitLifecycleEvent: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (h.state.cookies[name] ? { value: h.state.cookies[name] } : undefined),
    set: (name: string, value: string) => {
      h.state.cookies[name] = value
    },
    delete: (name: string) => {
      delete h.state.cookies[name]
    },
  })),
}))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: vi.fn((cb: () => unknown) => void cb()) }
})

import { GET as legacyCallback } from '@/app/api/whatsapp/callback/route'
import { POST as legacyConnect } from '@/app/api/auth/whatsapp/connect/route'
import { decrypt, encrypt, getUser } from '@/db/auth'
import { requireUser } from '@/lib/requireUser'
import { resolveWabaIdsFromToken } from '@/lib/whatsapp/resolveWaba'
import { isSealedWhatsappAccessToken, resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

const AGENCY = 69
const USER = 298
const PHONE = 'PHONE_1'

function response(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function callbackRequest() {
  return {
    url: 'https://app.test/api/whatsapp/callback?code=oauth-code&state=callback-state',
  } as unknown as import('next/server').NextRequest
}

function connectRequest(phoneNumberId = PHONE) {
  return { json: async () => ({ phoneNumberId }) } as unknown as import('next/server').NextRequest
}

function callbackFetch({ phoneRows = [{ id: PHONE, display_phone_number: '+972 50 000 0000', verified_name: 'Business' }], phoneOk = true } = {}) {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('grant_type=fb_exchange_token')) return response(200, { access_token: 'long-token' })
    if (url.includes('oauth/access_token')) return response(200, { access_token: 'short-token' })
    if (url.includes('/W1/phone_numbers')) return phoneOk ? response(200, { data: phoneRows }) : response(500, {})
    throw new Error(`unexpected Graph request: ${url}`)
  }) as unknown as typeof fetch
}

function connectFetch(subscribed = true) {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('subscribed_apps')) return subscribed ? response(200, { success: true }) : response(400, {})
    throw new Error(`unexpected Graph request: ${url}`)
  }) as unknown as typeof fetch
}

function emitted(event: 'whatsapp_phone_discovered' | 'whatsapp_signup_completed') {
  return h.state.emitted.filter((row) => row.event === event)
}

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'app-id')
  vi.stubEnv('META_APP_SECRET', 'app-secret')
  h.state.cookies = { wa_oauth_state: 'callback-state', wa_phones: 'sealed-pending-phones' }
  h.state.existing = null
  h.state.merged = []
  h.state.insertError = false
  h.state.emitted = []
  h.trackOncePerAgency.mockClear()
  vi.mocked(getUser).mockResolvedValue({ id: USER, agencyId: AGENCY, email: 'rep@example.com' } as never)
  // Phase 2 put both legacy routes behind an admin boundary; the fixture is a
  // caller permitted to reach the flow. Authorization itself is covered in
  // __tests__/connections/phase2AuthorizationBoundaries.test.ts.
  vi.mocked(requireUser).mockResolvedValue({
    id: USER,
    agencyId: AGENCY,
    role: 'ADMIN',
    email: 'rep@example.com',
  } as never)
  vi.mocked(encrypt).mockResolvedValue('sealed-pending-phones' as never)
  vi.mocked(decrypt).mockResolvedValue({
    userId: USER,
    phones: [{ id: PHONE, accessToken: 'long-token', wabaId: 'W1' }],
  } as never)
  vi.mocked(resolveWabaIdsFromToken).mockResolvedValue(['W1'])
})

describe('legacy WhatsApp OAuth — phone discovery', () => {
  it('emits one confirmed-phone event after Graph resolves a usable pending phone', async () => {
    callbackFetch()

    const result = await legacyCallback(callbackRequest())

    expect(result.status).toBe(307)
    expect(emitted('whatsapp_phone_discovered')).toEqual([
      { agencyId: AGENCY, userId: USER, event: 'whatsapp_phone_discovered', props: {} },
    ])
  })

  it('emits no phone event when the discovery result is empty or fails', async () => {
    callbackFetch({ phoneRows: [] })
    const empty = await legacyCallback(callbackRequest())
    expect(empty.headers.get('location')).toContain('wa_error=no_phones')

    h.state.cookies.wa_oauth_state = 'callback-state'
    callbackFetch({ phoneOk: false })
    const failed = await legacyCallback(callbackRequest())
    expect(failed.headers.get('location')).toContain('wa_error=no_phones')

    expect(emitted('whatsapp_phone_discovered')).toHaveLength(0)
  })

  it('deduplicates repeated successful callbacks through the existing once-per-agency tracker', async () => {
    callbackFetch()
    await legacyCallback(callbackRequest())

    h.state.cookies.wa_oauth_state = 'callback-state'
    await legacyCallback(callbackRequest())

    expect(h.trackOncePerAgency).toHaveBeenCalledTimes(2)
    expect(emitted('whatsapp_phone_discovered')).toHaveLength(1)
  })
})

describe('legacy WhatsApp OAuth — signup completion', () => {
  it('emits one signup-completed event after the selected pending phone is persisted', async () => {
    connectFetch()

    const result = await legacyConnect(connectRequest())

    expect(result.status).toBe(200)
    expect(h.state.merged).toHaveLength(1)
    // The legacy route seals too: the stored value is never the token itself.
    const stored = String(h.state.merged[0].access_token)
    expect(stored).not.toContain('long-token')
    expect(isSealedWhatsappAccessToken(stored)).toBe(true)
    expect(resolveWhatsappAccessToken(stored)).toBe('long-token')
    expect(emitted('whatsapp_signup_completed')).toEqual([
      { agencyId: AGENCY, userId: USER, event: 'whatsapp_signup_completed', props: {} },
    ])
  })

  it('emits no signup event when persistence fails or the pending phone is abandoned', async () => {
    connectFetch()
    h.state.insertError = true
    const failed = await legacyConnect(connectRequest())
    expect(failed.status).toBe(500)

    h.state.insertError = false
    delete h.state.cookies.wa_phones
    const abandoned = await legacyConnect(connectRequest())
    expect(abandoned.status).toBe(400)

    expect(emitted('whatsapp_signup_completed')).toHaveLength(0)
  })

  it('does not duplicate signup completion when a successful connect request is retried', async () => {
    connectFetch()
    const first = await legacyConnect(connectRequest())
    expect(first.status).toBe(200)

    h.state.cookies.wa_phones = 'sealed-pending-phones'
    h.state.existing = { agency_id: AGENCY }
    const replay = await legacyConnect(connectRequest())
    expect(replay.status).toBe(200)

    expect(emitted('whatsapp_signup_completed')).toHaveLength(1)
    expect(h.trackOncePerAgency).toHaveBeenCalledTimes(1)
  })
})
