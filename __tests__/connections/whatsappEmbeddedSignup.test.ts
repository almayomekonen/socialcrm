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
  const state = { existing: null as { agency_id: number } | null, merged: [] as unknown[] }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.whereRaw = () => qb
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

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/lib/whatsapp/registration', () => ({
  ensureMessagingReady: vi.fn(async () => ({ ready: true, status: 'CONNECTED' })),
}))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'
import { getUser } from '@/db/auth'

const AGENCY = 69
const USER = 298

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** Route fetch calls: token exchange, then subscribed_apps. */
function mockFetch({ subscribedOk }: { subscribedOk: boolean }) {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('oauth/access_token')) return res(200, { access_token: 'tok_abc' })
    if (u.includes('subscribed_apps')) return subscribedOk ? res(200, { success: true }) : res(400, { error: { message: 'Object does not exist', code: 100 } })
    return res(200, {})
  }) as unknown as typeof fetch
}

function req(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  h.state.existing = null
  h.state.merged = []
  vi.mocked(getUser).mockResolvedValue({ id: USER, agencyId: AGENCY, email: 'x@example.com' } as never)
})

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
})
