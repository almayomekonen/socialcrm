/**
 * Reconnect refreshes this agency's already-connected Pages — and nothing else.
 * Real Postgres; Meta's subscribe call is faked.
 *
 * Run: npm run test:db -- __tests__/facebook/refreshConnectedPages.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 4).toString('base64')
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})

import { db } from '@/config/db'
import { refreshConnectedPages } from '@/lib/facebook/refreshConnectedPages'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'

let agency = 0
let other = 0
let me = 0
const MINE = '__rcp_mine__'
const THEIRS = '__rcp_theirs__'
const COLLEAGUES = '__rcp_colleague__'
let subscribeBodies: URLSearchParams[] = []

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_rcp__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_rcp_other__' }).returning('id')
  agency = Number(a.id)
  other = Number(b.id)
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = String(agency)
  const [u] = await db('users').insert({ firstName: 'R', role: 'ADMIN', agencyId: agency }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'R2', role: 'ADMIN', agencyId: other }).returning('id')
  const [u3] = await db('users').insert({ firstName: 'R3', role: 'ADMIN', agencyId: agency }).returning('id')
  me = Number(u.id)
  await db('facebook_pages').insert([
    { user_id: u.id, agency_id: agency, page_id: MINE, page_name: 'Old', page_access_token: 'OLD-PLAINTEXT', health_status: 'token_expired' },
    { user_id: u2.id, agency_id: other, page_id: THEIRS, page_name: 'Theirs', page_access_token: 'THEIR-TOKEN', health_status: 'healthy' },
    // Same agency, connected by a DIFFERENT admin: left to the picker, never silently refreshed.
    { user_id: u3.id, agency_id: agency, page_id: COLLEAGUES, page_name: 'Colleague', page_access_token: 'COLLEAGUE-TOKEN', health_status: 'healthy' },
  ])
})

beforeEach(() => {
  subscribeBodies = []
  global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    subscribeBodies.push(new URLSearchParams(String(init?.body)))
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }) as unknown as typeof fetch
})

afterAll(async () => {
  await db('facebook_pages').whereIn('page_id', [MINE, THEIRS, COLLEAGUES]).del()
  await db('users').whereIn('agencyId', [agency, other]).del()
  await db('agencies').whereIn('id', [agency, other]).del()
  await db.destroy()
})

describe('refreshConnectedPages', () => {
  it('updates only the agency\'s own Page: sealed new token, new grant, re-subscribed with Messenger fields, healthy again', async () => {
    const scopes = ['pages_show_list', 'leads_retrieval', 'pages_messaging', 'pages_manage_metadata']
    const result = await refreshConnectedPages({
      agencyId: agency,
      userId: me,
      grantedScopes: scopes,
      pages: [
        { id: MINE, name: 'New Name', access_token: 'NEW-TOKEN' },
        // Returned by Meta for this Facebook user, but owned by another agency: must not be touched.
        { id: THEIRS, name: 'Hijack', access_token: 'ATTACKER-TOKEN' },
        // Same agency, another admin's connection: must not be touched either.
        { id: COLLEAGUES, name: 'Takeover', access_token: 'MY-TOKEN-FOR-THEIR-PAGE' },
      ],
    })
    expect(result).toEqual({ refreshed: 1, subscribeFailed: 0 })

    const mine = await db('facebook_pages').where({ page_id: MINE }).first()
    expect(mine.page_access_token.startsWith('scm1.')).toBe(true)
    expect(resolvePageAccessToken(mine.page_access_token)).toBe('NEW-TOKEN')
    expect(mine.page_name).toBe('New Name')
    expect(mine.health_status).toBe('healthy')
    expect(mine.granted_scopes).toEqual(scopes)

    const theirs = await db('facebook_pages').where({ page_id: THEIRS }).first()
    expect(theirs).toMatchObject({ page_access_token: 'THEIR-TOKEN', page_name: 'Theirs' })
    const colleague = await db('facebook_pages').where({ page_id: COLLEAGUES }).first()
    expect(colleague).toMatchObject({ page_access_token: 'COLLEAGUE-TOKEN', page_name: 'Colleague' })

    expect(subscribeBodies).toHaveLength(1)
    expect(subscribeBodies[0].get('subscribed_fields')).toBe('leadgen,feed,messages,message_echoes,message_deliveries,message_reads,messaging_postbacks,messaging_referrals,message_reactions')
    expect(subscribeBodies[0].get('access_token')).toBe('NEW-TOKEN')
  })

  it('a refused re-subscribe still stores the fresh token but does not claim the Page is healthy', async () => {
    await db('facebook_pages').where({ page_id: MINE }).update({ health_status: 'token_expired' })
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 200 } }) })) as unknown as typeof fetch
    const result = await refreshConnectedPages({ agencyId: agency, userId: me, grantedScopes: [], pages: [{ id: MINE, name: 'N', access_token: 'NEWER' }] })
    expect(result).toEqual({ refreshed: 1, subscribeFailed: 1 })
    const mine = await db('facebook_pages').where({ page_id: MINE }).first()
    expect(resolvePageAccessToken(mine.page_access_token)).toBe('NEWER')
    expect(mine.health_status).toBe('token_expired')
  })
})
