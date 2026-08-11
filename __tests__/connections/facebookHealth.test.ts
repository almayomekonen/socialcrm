/**
 * Facebook Page health + repair — require leadgen AND feed.
 *
 * Lead Ads (leadgen) must stay required. feed is required for Comments MVP.
 * Repair must always POST the full field set so Meta never strips leadgen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    connection: { page_id: 'PG1', page_access_token: 'ptok', agency_id: 23 } as Record<string, unknown> | null,
  }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.first = async () => state.connection
  const db = Object.assign((_table: string) => qb, { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))

import { checkFacebookConnection, repairFacebookConnection } from '@/lib/facebook/health'
import { FACEBOOK_PAGE_WEBHOOK_FIELDS } from '@/lib/facebook/pageWebhookFields'

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function appsWithFields(fields: string[]) {
  return { data: [{ id: 'APP', subscribed_fields: fields }] }
}

beforeEach(() => {
  h.state.connection = { page_id: 'PG1', page_access_token: 'ptok', agency_id: 23 }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('checkFacebookConnection — required webhook fields', () => {
  it('leadgen only => unhealthy (not subscribed)', async () => {
    global.fetch = vi.fn(async () => jsonRes(200, appsWithFields(['leadgen']))) as unknown as typeof fetch
    const status = await checkFacebookConnection('PG1', 'ptok')
    expect(status.tokenValid).toBe(true)
    expect(status.subscribed).toBe(false)
    expect(status.needsReconnect).toBe(false)
    expect(status.errors).toContain('not_subscribed')
  })

  it('leadgen + feed => healthy', async () => {
    global.fetch = vi.fn(async () => jsonRes(200, appsWithFields(['leadgen', 'feed']))) as unknown as typeof fetch
    const status = await checkFacebookConnection('PG1', 'ptok')
    expect(status.tokenValid).toBe(true)
    expect(status.permissionsOk).toBe(true)
    expect(status.subscribed).toBe(true)
    expect(status.needsReconnect).toBe(false)
    expect(status.errors).toEqual([])
  })

  it('feed only => unhealthy (Lead Ads must remain required)', async () => {
    global.fetch = vi.fn(async () => jsonRes(200, appsWithFields(['feed']))) as unknown as typeof fetch
    const status = await checkFacebookConnection('PG1', 'ptok')
    expect(status.subscribed).toBe(false)
    expect(status.errors).toContain('not_subscribed')
  })
})

describe('repairFacebookConnection — upgrades missing fields to leadgen,feed', () => {
  it('missing feed => repair POSTs leadgen,feed', async () => {
    let getCount = 0
    global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (u.includes('subscribed_apps') && method === 'POST') {
        const body = String(init?.body)
        expect(body.includes('leadgen') && body.includes('feed')).toBe(true)
        expect(FACEBOOK_PAGE_WEBHOOK_FIELDS).toBe('leadgen,feed')
        return jsonRes(200, { success: true })
      }
      getCount++
      return jsonRes(200, appsWithFields(['leadgen']))
    }) as unknown as typeof fetch

    const result = await repairFacebookConnection('PG1')
    expect(result.repaired).toBe(true)
    expect(result.needsReconnect).toBe(false)
    expect(result.status.subscribed).toBe(true)
    expect(getCount).toBeGreaterThan(0)
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(post).toBeTruthy()
  })

  it('missing leadgen => repair POSTs leadgen,feed', async () => {
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'POST') {
        const body = String(init?.body)
        expect(body.includes('leadgen') && body.includes('feed')).toBe(true)
        return jsonRes(200, { success: true })
      }
      return jsonRes(200, appsWithFields(['feed']))
    }) as unknown as typeof fetch

    const result = await repairFacebookConnection('PG1')
    expect(result.repaired).toBe(true)
    expect(result.status.subscribed).toBe(true)
  })

  it('already leadgen+feed => no repair POST', async () => {
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        throw new Error('should not POST when already healthy')
      }
      return jsonRes(200, appsWithFields(['leadgen', 'feed']))
    }) as unknown as typeof fetch

    const result = await repairFacebookConnection('PG1')
    expect(result.repaired).toBe(false)
    expect(result.status.subscribed).toBe(true)
  })
})
