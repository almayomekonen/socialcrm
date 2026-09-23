/**
 * Can a Page that was ALREADY connected start receiving the new Messenger
 * events?
 *
 * This is the question the 2026-09-14 incident answered the hard way: Messenger
 * was rolled out, the grant was on the row, and Meta sent nothing, because
 * turning a rollout on does not touch a Page's own `subscribed_apps`. Adding
 * five webhook fields to the code has exactly the same failure mode.
 *
 * Configuring the Meta dashboard is NOT sufficient — that is the app-level half.
 * Each Page must also be re-subscribed with the new field set, and the only
 * thing that does that automatically is the hourly connection-health sweep.
 * These tests pin that path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  posts: [] as string[],
  subscribedFields: ['leadgen', 'feed', 'messages', 'message_echoes'],
}))

vi.hoisted(() => {
  process.env.META_APP_ID = 'APP123'
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = 'all'
})

vi.mock('@/config/db', () => {
  const page = {
    id: 1,
    agency_id: 7,
    page_id: 'PG1',
    page_access_token: 'tok',
    granted_scopes: JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging']),
  }
  const builder = {
    where: () => builder,
    first: async () => page,
    select: async () => [page],
    update: async () => 1,
  }
  return { db: Object.assign(() => builder, { raw: (s: string) => s }) }
})

vi.mock('@/lib/facebook/pageToken', () => ({ resolvePageAccessToken: (t: string) => t }))

import { repairFacebookConnection } from '@/lib/facebook/health'
import {
  MESSENGER_SIGNAL_FIELDS,
  MESSENGER_WEBHOOK_FIELDS,
  pageWebhookFieldList,
} from '@/lib/facebook/pageWebhookFields'

function jsonRes(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

/** Meta's view of the Page: which fields OUR app is subscribed to. */
function graph(onPost: (fields: string) => Response = () => jsonRes(200, { success: true })) {
  global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      const fields = new URLSearchParams(String(init?.body)).get('subscribed_fields') ?? ''
      h.posts.push(fields)
      return onPost(fields)
    }
    // /me/permissions and /subscribed_apps both come through here.
    return jsonRes(200, {
      data: [{ id: 'APP123', subscribed_fields: h.subscribedFields }],
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  h.posts = []
  h.subscribedFields = ['leadgen', 'feed', 'messages', 'message_echoes']
})

describe('the field set a connected Page should have', () => {
  it('includes the five new signal fields once pages_messaging is granted and Messenger is rolled out', () => {
    const fields = pageWebhookFieldList({
      grantedScopes: ['pages_messaging'],
      messengerEnabled: true,
    })
    for (const field of [...MESSENGER_WEBHOOK_FIELDS, ...MESSENGER_SIGNAL_FIELDS]) {
      expect(fields).toContain(field)
    }
    // Lead Ads and comments are never dropped to make room.
    expect(fields).toContain('leadgen')
    expect(fields).toContain('feed')
  })

  it('does NOT include them for an agency outside the Messenger rollout', () => {
    const fields = pageWebhookFieldList({ grantedScopes: ['pages_messaging'], messengerEnabled: false })
    expect(fields).toEqual(['leadgen', 'feed'])
  })

  it('does NOT include them when the Page never granted pages_messaging', () => {
    const fields = pageWebhookFieldList({ grantedScopes: ['pages_show_list'], messengerEnabled: true })
    expect(fields).toEqual(['leadgen', 'feed'])
  })
})

describe('an already-connected Page converges without anyone reconnecting it', () => {
  it('a Page on the OLD field set is re-subscribed with the new ones', async () => {
    // Exactly the state of every Page connected before this change.
    h.subscribedFields = ['leadgen', 'feed', 'messages', 'message_echoes']
    graph()

    const result = await repairFacebookConnection('PG1')

    expect(result.repaired).toBe(true)
    expect(h.posts).toHaveLength(1)
    for (const field of MESSENGER_SIGNAL_FIELDS) {
      expect(h.posts[0]).toContain(field)
    }
    // And the fields it already had are re-sent, because Meta REPLACES the set.
    expect(h.posts[0]).toContain('leadgen')
    expect(h.posts[0]).toContain('messages')
  })

  it('a Page already on the full set is left alone — no pointless Graph write', async () => {
    h.subscribedFields = [...pageWebhookFieldList({ grantedScopes: ['pages_messaging'], messengerEnabled: true })]
    graph()

    const result = await repairFacebookConnection('PG1')

    expect(h.posts).toEqual([])
    expect(result.repaired).toBe(false)
    expect(result.status.missingFields).toEqual([])
  })

  it('if Meta refuses one new field, core Messenger and Lead Ads still survive', async () => {
    h.subscribedFields = ['leadgen', 'feed', 'messages', 'message_echoes']
    graph((fields) => (fields.includes('message_reactions') ? jsonRes(400, { error: { code: 100 } }) : jsonRes(200, { success: true })))

    const result = await repairFacebookConnection('PG1')

    // Full set refused → core tier accepted. Never all the way down to Lead Ads.
    expect(h.posts).toHaveLength(2)
    expect(h.posts[1]).toBe('leadgen,feed,messages,message_echoes')
    expect(result.repaired).toBe(true)
    expect(result.status.missingEssentialFields).toEqual([])
  })
})
