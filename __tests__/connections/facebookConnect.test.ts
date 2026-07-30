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

vi.mock('@/config/db', () => ({ db: h.db }))
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

const AGENCY = 69

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function mockFetch({ subscribedOk }: { subscribedOk: boolean }) {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('subscribed_apps')) return subscribedOk ? res(200, { success: true, data: [] }) : res(400, { error: { message: 'no perm' } })
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
  h.state.existing = null
  h.state.merged = []
  vi.mocked(getUser).mockResolvedValue({ id: 1, agencyId: AGENCY, email: 'x@example.com' } as never)
})

describe('Facebook connect — persistence & tenancy', () => {
  it('FB-1: subscription succeeds → Page persisted, ok:true', async () => {
    mockFetch({ subscribedOk: true })
    const r = await POST(req(validBody))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true })
    expect(h.state.merged).toHaveLength(1)
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
