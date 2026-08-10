/**
 * Facebook `feed` webhook canary — isolation and safety tests.
 *
 * The canary's whole value depends on it being invisible: the shipped leadgen
 * path must behave identically, every non-canary Page must be untouched, and no
 * customer content may reach the logs. These tests assert exactly that, so the
 * experiment can be run against a real Page without a leap of faith.
 *
 * Unit-level (mocked db/fetch/adapters) — the DB harness is unavailable here;
 * see facebookConnect.test.ts for the same approach.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'

const h = vi.hoisted(() => {
  const state = {
    connection: null as Record<string, unknown> | null,
    existingClient: undefined as unknown,
    failures: [] as unknown[],
    updates: [] as unknown[],
  }
  function qbFor(table: string) {
    const qb: Record<string, unknown> = {}
    qb.where = () => qb
    qb.whereLike = () => qb
    qb.first = async () => (table === 'facebook_pages' ? state.connection : state.existingClient)
    qb.insert = (obj: unknown) => {
      if (table === 'webhook_failures') state.failures.push(obj)
      return Promise.resolve([1])
    }
    qb.update = (obj: unknown) => {
      state.updates.push({ table, obj })
      return Promise.resolve(1)
    }
    return qb
  }
  const db = Object.assign((table: string) => qbFor(table), { raw: async () => ({}) })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/lib/facebook/health', () => ({ repairFacebookConnection: vi.fn(async () => ({})) }))
vi.mock('@/lib/adapters/facebookLead', () => ({
  parseFacebookLead: vi.fn(() => ({ firstName: 'דוד', lastName: 'כהן', phone: '972500000000', email: null })),
}))
vi.mock('@/lib/system/createClientFromWebhook', () => ({
  createLeadFromWebhook: vi.fn(async () => ({ id: 42 })),
}))

import { POST } from '@/app/api/webhooks/facebook/route'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { summarizeFeedChange, isCanaryPage } from '@/lib/facebook/commentsCanary'

const SECRET = 'test-app-secret-not-real'
const CANARY_PAGE = '111122223333'
const OTHER_PAGE = '999988887777'

/** The comment content that must never appear in a log line. */
const SECRET_MESSAGE = 'כמה עולה? אני מעוניין'
const AUTHOR_ID = '5566778899'

const feedChange = (over: Record<string, unknown> = {}) => ({
  field: 'feed',
  value: {
    item: 'comment',
    verb: 'add',
    comment_id: `${CANARY_PAGE}_444555`,
    post_id: `${CANARY_PAGE}_222333`,
    from: { id: AUTHOR_ID, name: 'דוד כהן' },
    message: SECRET_MESSAGE,
    created_time: 1786000000,
    ...over,
  },
})

const leadgenChange = () => ({ field: 'leadgen', value: { leadgen_id: 'LEAD_1' } })

function req(body: unknown, signature?: string) {
  const raw = JSON.stringify(body)
  const sig = signature ?? 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return {
    text: async () => raw,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-hub-signature-256' ? sig : null) },
  } as unknown as import('next/server').NextRequest
}

let logs: string[] = []

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET
  process.env.FACEBOOK_COMMENTS_CANARY_PAGE_ID = CANARY_PAGE
  h.state.connection = { page_id: CANARY_PAGE, agency_id: 7, user_id: 3, health_status: 'healthy', page_access_token: 'ptok' }
  h.state.existingClient = undefined
  h.state.failures = []
  h.state.updates = []
  vi.mocked(createLeadFromWebhook).mockClear()

  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))

  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ field_data: [{ name: 'full_name', values: ['דוד כהן'] }] }),
    text: async () => '{}',
  })) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.FACEBOOK_COMMENTS_CANARY_PAGE_ID
})

const canaryLines = () => logs.filter((l) => l.includes('[FacebookCommentsCanary]'))

describe('feed canary — the shipped leadgen path is untouched', () => {
  it('CANARY-1: a leadgen change still creates a Lead through the existing path', async () => {
    const r = await POST(req({ entry: [{ id: CANARY_PAGE, changes: [leadgenChange()] }] }))

    expect(r.status).toBe(200)
    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createLeadFromWebhook).mock.calls[0][0]).toMatchObject({
      leadId: 'LEAD_1',
      agencyId: 7,
      userId: 3,
    })
    expect(canaryLines()).toHaveLength(0)
  })

  it('CANARY-2: a change with no `field` key still reaches the leadgen path', async () => {
    // Guards the deliberate branch choice: we skip `feed`, we do not gate
    // leadgen on its field name. Narrowing leadgen would silently drop leads.
    await POST(req({ entry: [{ id: CANARY_PAGE, changes: [{ value: { leadgen_id: 'LEAD_2' } }] }] }))

    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1)
  })

  it('CANARY-3: a feed event never prevents a sibling leadgen in the same batch', async () => {
    await POST(
      req({
        entry: [
          { id: CANARY_PAGE, changes: [feedChange(), leadgenChange()] },
          { id: CANARY_PAGE, changes: [feedChange({ verb: 'edited' })] },
        ],
      }),
    )

    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1)
    expect(canaryLines()).toHaveLength(2)
  })
})

describe('feed canary — the gate', () => {
  it('CANARY-4: feed is observed for the canary Page only', async () => {
    await POST(req({ entry: [{ id: CANARY_PAGE, changes: [feedChange()] }] }))

    expect(canaryLines()).toHaveLength(1)
    const payload = JSON.parse(canaryLines()[0].replace('[FacebookCommentsCanary] ', ''))
    expect(payload).toMatchObject({
      item: 'comment',
      verb: 'add',
      commentIdPresent: true,
      postIdPresent: true,
      authorIdPresent: true,
      authorNamePresent: true,
      messagePresent: true,
      messageLength: SECRET_MESSAGE.length,
      parentIdPresent: false,
    })
    expect(payload.pageId).toBe(`…${CANARY_PAGE.slice(-4)}`)
  })

  it('CANARY-5: feed is ignored for every other Page — nothing logged, nothing created', async () => {
    h.state.connection = { page_id: OTHER_PAGE, agency_id: 8, user_id: 4, health_status: 'healthy', page_access_token: 'p2' }
    await POST(req({ entry: [{ id: OTHER_PAGE, changes: [feedChange()] }] }))

    expect(canaryLines()).toHaveLength(0)
    expect(createLeadFromWebhook).not.toHaveBeenCalled()
    expect(h.state.failures).toHaveLength(0)
  })

  it('CANARY-6: with the env var unset the gate fails closed', async () => {
    delete process.env.FACEBOOK_COMMENTS_CANARY_PAGE_ID
    await POST(req({ entry: [{ id: CANARY_PAGE, changes: [feedChange()] }] }))

    expect(canaryLines()).toHaveLength(0)
    expect(isCanaryPage(CANARY_PAGE)).toBe(false)
  })

  it('CANARY-7: signature verification still runs before any event is processed', async () => {
    const r = await POST(req({ entry: [{ id: CANARY_PAGE, changes: [feedChange(), leadgenChange()] }] }, 'sha256=deadbeef'))

    expect(r.status).toBe(403)
    expect(canaryLines()).toHaveLength(0)
    expect(createLeadFromWebhook).not.toHaveBeenCalled()
  })
})

describe('feed canary — malformed payloads', () => {
  it.each([
    ['null value', { field: 'feed', value: null }],
    ['string value', { field: 'feed', value: 'not-an-object' }],
    ['no value key', { field: 'feed' }],
    ['from is a string', { field: 'feed', value: { from: 'nope', message: 7 } }],
  ])('CANARY-8 (%s): does not crash the webhook', async (_label, change) => {
    const r = await POST(req({ entry: [{ id: CANARY_PAGE, changes: [change, leadgenChange()] }] }))

    expect(r.status).toBe(200)
    expect(createLeadFromWebhook).toHaveBeenCalledTimes(1) // sibling survived
  })

  it('CANARY-9: summarizeFeedChange is total over hostile input', () => {
    for (const v of [null, undefined, 0, 'x', [], { from: null }]) {
      expect(() => summarizeFeedChange(CANARY_PAGE, v)).not.toThrow()
    }
    expect(summarizeFeedChange(CANARY_PAGE, null)).toMatchObject({
      messagePresent: false,
      messageLength: 0,
      authorIdPresent: false,
      commentIdPresent: false,
    })
  })
})

describe('feed canary — no customer content or credentials in logs', () => {
  it('CANARY-10: message text, author id, comment id and token never appear', async () => {
    await POST(req({ entry: [{ id: CANARY_PAGE, changes: [feedChange()] }] }))

    const all = logs.join('\n')
    expect(all).not.toContain(SECRET_MESSAGE)
    expect(all).not.toContain(AUTHOR_ID)
    expect(all).not.toContain(`${CANARY_PAGE}_444555`) // comment id
    expect(all).not.toContain('ptok') // Page access token
    expect(all).not.toContain(SECRET) // app secret
    expect(all).not.toContain('דוד כהן') // author name
  })

  it('CANARY-11: the full Page id is masked to its last four characters', async () => {
    await POST(req({ entry: [{ id: CANARY_PAGE, changes: [feedChange()] }] }))

    expect(canaryLines()[0]).not.toContain(CANARY_PAGE)
    expect(canaryLines()[0]).toContain(CANARY_PAGE.slice(-4))
  })
})
