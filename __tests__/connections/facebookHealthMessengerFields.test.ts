/**
 * Facebook Page health — the Messenger half and the reading of Graph failures.
 *
 * Incident 2026-09-14: Messenger was rolled out to agency 103 and `pages_messaging`
 * was recorded on the Page, but the Page was subscribed to `leadgen,feed` only.
 * Meta never delivered a message, and the hourly repair called the Page healthy
 * because it only ever compared against leadgen,feed.
 *
 * Split from facebookHealth.test.ts (Lead Ads + comments fields), same fixtures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { connection: null as Record<string, unknown> | null }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.first = async () => state.connection
  const db = Object.assign((_table: string) => qb, { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))

import { checkFacebookConnection, repairFacebookConnection } from '@/lib/facebook/health'

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function appsWithFields(fields: string[]) {
  return { data: [{ id: 'APP', subscribed_fields: fields }] }
}

const MESSENGER_PAGE = {
  page_id: 'PG1',
  page_access_token: 'ptok',
  agency_id: 103,
  granted_scopes: JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'leads_retrieval']),
}

/** Graph stub: GET answers `currentFields`; each POST records its field list and answers `postStatus`. */
function graph(currentFields: string[], postStatus = 200) {
  const posts: string[] = []
  global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      posts.push(new URLSearchParams(String(init?.body)).get('subscribed_fields') ?? '')
      return postStatus === 200 ? jsonRes(200, { success: true }) : jsonRes(postStatus, { error: { code: 200 } })
    }
    return jsonRes(200, appsWithFields(currentFields))
  }) as unknown as typeof fetch
  return posts
}

beforeEach(() => {
  h.state.connection = { ...MESSENGER_PAGE }
  vi.stubEnv('META_APP_ID', '')
  vi.stubEnv('FACEBOOK_MESSENGER_ENABLED', '1')
  vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '103')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('checkFacebookConnection — reading Graph', () => {
  it('one Graph read answers both the token and the subscription question', async () => {
    graph(['leadgen', 'feed'])
    await checkFacebookConnection('PG1', 'ptok', ['leadgen', 'feed', 'messages', 'message_echoes'])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a Graph outage', 500, { error: { code: 2 } }],
    ['a rate limit answered with HTTP 403', 403, { error: { code: 4, message: '(#4) Application request limit reached' } }],
    ['a Page rate limit', 400, { error: { code: 32 } }],
    ['a transient error', 400, { error: { code: 1, is_transient: true } }],
    ['an unparseable body', 502, null],
  ] as const)('%s is not a dead token and claims nothing about fields', async (_name, status, body) => {
    global.fetch = vi.fn(async () => jsonRes(status, body)) as unknown as typeof fetch
    const result = await checkFacebookConnection('PG1', 'ptok', ['leadgen', 'feed', 'messages'])
    expect(result.errors).toEqual(['token_check_failed'])
    expect(result.missingFields).toBeUndefined()
    // Unchanged for the sweep and the status route.
    expect(result.needsReconnect).toBe(true)
  })

  it.each([
    [401, { error: { code: 190 } }],
    [400, { error: { code: 190, error_subcode: 463 } }],
    [401, null],
  ] as const)('a token Meta refused (HTTP %s) is token_invalid', async (status, body) => {
    global.fetch = vi.fn(async () => jsonRes(status, body)) as unknown as typeof fetch
    expect((await checkFacebookConnection('PG1', 'ptok')).errors).toEqual(['token_invalid'])
  })

  it('a missing permission is permission_missing, not a dead connection', async () => {
    global.fetch = vi.fn(async () => jsonRes(403, { error: { code: 200 } })) as unknown as typeof fetch
    expect((await checkFacebookConnection('PG1', 'ptok')).errors).toEqual(['permission_missing'])
  })

  it("another app's Messenger or Lead Ads subscription never counts as ours", async () => {
    vi.stubEnv('META_APP_ID', 'OURS')
    global.fetch = vi.fn(async () =>
      jsonRes(200, {
        data: [
          { id: 'MANYCHAT', subscribed_fields: ['messages', 'message_echoes', 'leadgen'] },
          { id: 'OURS', subscribed_fields: ['feed'] },
        ],
      }),
    ) as unknown as typeof fetch
    const status = await checkFacebookConnection('PG1', 'ptok', ['leadgen', 'feed', 'messages', 'message_echoes'])
    expect(status.subscribed).toBe(false)
    expect(status.missingFields).toEqual(['leadgen', 'messages', 'message_echoes'])
  })

  it('warns when the Page has subscribed apps but none is META_APP_ID', async () => {
    vi.stubEnv('META_APP_ID', 'OURS')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    graph(['leadgen', 'feed'])
    await checkFacebookConnection('PG1', 'ptok')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('none of them META_APP_ID'), { apps: 1 })
  })
})

describe('Messenger fields — a granted, rolled-out Page converges', () => {
  it('the check names the missing Messenger fields without calling Lead Ads unhealthy', async () => {
    graph(['leadgen', 'feed'])
    const status = await checkFacebookConnection('PG1', 'ptok', ['leadgen', 'feed', 'messages', 'message_echoes'])
    expect(status.subscribed).toBe(true)
    expect(status.errors).toEqual([])
    expect(status.missingFields).toEqual(['messages', 'message_echoes'])
  })

  it('repair subscribes messages,message_echoes and re-sends leadgen,feed in the same call', async () => {
    const posts = graph(['leadgen', 'feed'])
    const result = await repairFacebookConnection('PG1')
    expect(posts).toEqual(['leadgen,feed,messages,message_echoes'])
    expect(result.repaired).toBe(true)
    expect(result.status.subscribed).toBe(true)
    expect(result.status.missingFields).toEqual([])
  })

  it('repair does not touch a Page already subscribed to everything it needs', async () => {
    const posts = graph(['leadgen', 'feed', 'messages', 'message_echoes'])
    const result = await repairFacebookConnection('PG1')
    expect(posts).toEqual([])
    expect(result.repaired).toBe(false)
  })

  it('repair leaves a Lead Ads Page alone when Messenger is not rolled out to its agency', async () => {
    vi.stubEnv('FACEBOOK_MESSENGER_AGENCY_ALLOWLIST', '999')
    const posts = graph(['leadgen', 'feed'])
    const result = await repairFacebookConnection('PG1')
    expect(posts).toEqual([])
    expect(result.status.missingFields).toEqual([])
  })

  it('repair never asks for Messenger fields without the recorded pages_messaging grant', async () => {
    h.state.connection = { ...MESSENGER_PAGE, granted_scopes: JSON.stringify(['pages_show_list', 'leads_retrieval']) }
    const posts = graph(['leadgen'])
    await repairFacebookConnection('PG1')
    expect(posts).toEqual(['leadgen,feed'])
  })

  it('a refused Messenger field never costs Lead Ads: leadgen,feed are restored on their own', async () => {
    const posts: string[] = []
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        const fields = new URLSearchParams(String(init?.body)).get('subscribed_fields') ?? ''
        posts.push(fields)
        return fields.includes('messages') ? jsonRes(400, { error: { code: 200 } }) : jsonRes(200, { success: true })
      }
      return jsonRes(200, appsWithFields(['feed']))
    }) as unknown as typeof fetch
    const result = await repairFacebookConnection('PG1')
    expect(posts).toEqual(['leadgen,feed,messages,message_echoes', 'leadgen,feed'])
    expect(result.repaired).toBe(true)
    expect(result.status.subscribed).toBe(true)
    expect(result.status.missingFields).toEqual(['messages', 'message_echoes'])
  })

  it('a network error or Graph outage on the POST never triggers the Lead Ads-only fallback', async () => {
    const posts = graph(['feed'], 503)
    const result = await repairFacebookConnection('PG1')
    expect(posts).toEqual(['leadgen,feed,messages,message_echoes'])
    expect(result.repaired).toBe(false)
  })

  it('a refused re-subscribe is not reported as repaired and keeps the missing fields', async () => {
    const posts = graph(['leadgen', 'feed'], 400)
    const result = await repairFacebookConnection('PG1')
    expect(posts).toHaveLength(1)
    expect(result.repaired).toBe(false)
    expect(result.status.missingFields).toEqual(['messages', 'message_echoes'])
  })
})
