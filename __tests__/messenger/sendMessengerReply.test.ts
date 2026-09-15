/**
 * sendMessengerReply / lead association — authorization, the 24-hour window,
 * the exact Send API call, and token hygiene. db, session and fetch are faked;
 * graphClient, rules and send are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 3).toString('base64')
  process.env.META_APP_SECRET = 'app-secret'
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = '103'
  const state = {
    conversation: null as Record<string, unknown> | null,
    page: null as Record<string, unknown> | null,
    wheres: [] as { table: string; w: unknown }[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    updates: [] as { table: string; u: unknown }[],
  }
  function qb(table: string) {
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      state.wheres.push({ table, w })
      return b
    }
    b.first = async () =>
      table === 'messenger_conversations' ? state.conversation : table === 'facebook_pages' ? state.page : undefined
    b.insert = (row: Record<string, unknown>) => {
      state.inserts.push({ table, row })
      return b
    }
    b.onConflict = () => b
    b.ignore = () => b
    b.merge = () => b
    b.returning = async () => [{ id: 55, created: true }]
    b.update = async (u: unknown) => {
      state.updates.push({ table, u })
      return 1
    }
    return b
  }
  const db = Object.assign((t: string) => qb(t), {
    raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
    fn: { now: () => 'now()' },
    transaction: async (fn: (trx: unknown) => unknown) => fn(Object.assign((t: string) => qb(t), { raw: (s: string) => s, fn: { now: () => 'now()' } })),
  })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({
  requireProductAccess: vi.fn(async () => ({ id: 7, agencyId: 103, role: 'AGNT' })),
  requireAgencyUser: vi.fn(async () => ({ id: 7, agencyId: 103, role: 'AGNT' })),
}))
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: vi.fn(async () => ({})) }))
vi.mock('@/actions/clients', () => ({ getLeadById: vi.fn(), upsertLead: vi.fn() }))

import { sendMessengerReply } from '@/modules/messenger/actions'
import { linkMessengerConversationToLead, createLeadFromMessengerConversation } from '@/modules/messenger/leadActions'
import { sealPageAccessToken } from '@/lib/facebook/pageToken'
import { getLeadById, upsertLead } from '@/actions/clients'

const PAGE = 'PAGE1'
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

beforeEach(() => {
  h.state.conversation = { id: 12, agencyId: 103, pageId: PAGE, psid: 'PSID-1', lastInboundAt: minutesAgo(30), leadId: null, customerName: 'דנה לוי' }
  h.state.page = {
    id: 1,
    agency_id: 103,
    page_id: PAGE,
    page_access_token: sealPageAccessToken('PAGE-TOKEN-ABC'),
    granted_scopes: JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging']),
  }
  h.state.wheres = []
  h.state.inserts = []
  h.state.updates = []
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ recipient_id: 'PSID-1', message_id: 'm_sent_1' }),
  })) as unknown as typeof fetch
  vi.mocked(getLeadById).mockReset()
  vi.mocked(upsertLead).mockReset()
})

describe('sendMessengerReply', () => {
  it('sends RESPONSE text to the conversation\'s PSID via POST /{page}/messages; token only in the header', async () => {
    expect(await sendMessengerReply(12, '  שלחתי לך פרטים  ')).toEqual({ ok: true })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/PAGE1\/messages\?appsecret_proof=[0-9a-f]{64}$/)
    expect(url).not.toContain('PAGE-TOKEN-ABC')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer PAGE-TOKEN-ABC')
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: 'PSID-1' },
      messaging_type: 'RESPONSE',
      message: { text: 'שלחתי לך פרטים' },
    })
  })

  it('records the sent message from Meta\'s response, keyed by its mid, as SocialCRM outbound by this user', async () => {
    await sendMessengerReply(12, 'היי')
    const row = h.state.inserts.find((i) => i.table === 'messenger_messages')!.row
    expect(row).toMatchObject({ mid: 'm_sent_1', direction: 'outbound', source: 'socialcrm', sentByUserId: 7, agencyId: 103, pageId: PAGE })
  })

  it('conversation lookup is agency-scoped: another agency\'s id is not found, and Meta is never called', async () => {
    h.state.conversation = null
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'not_found' })
    expect(h.state.wheres).toContainEqual({ table: 'messenger_conversations', w: { id: 12, agencyId: 103 } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('outside the 24-hour window nothing is sent — enforced on the server, before Meta', async () => {
    h.state.conversation!.lastInboundAt = minutesAgo(24 * 60 + 1)
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'window_closed' })
    h.state.conversation!.lastInboundAt = null
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'window_closed' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the Page must be this agency\'s AND carry pages_messaging', async () => {
    h.state.page!.granted_scopes = JSON.stringify(['pages_show_list'])
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'permission_missing' })
    expect(h.state.wheres).toContainEqual({ table: 'facebook_pages', w: { page_id: PAGE, agency_id: 103 } })
    h.state.page = null
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'reconnect_required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Meta refusing outside the window is reported as window_closed, and nothing is recorded', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 10, error_subcode: 2018278, message: 'This message is sent outside of allowed window.' } }),
    })) as unknown as typeof fetch
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'window_closed' })
    expect(h.state.inserts.filter((i) => i.table === 'messenger_messages')).toHaveLength(0)
  })

  it('rejects empty and over-long text without calling Meta', async () => {
    expect(await sendMessengerReply(12, ' ')).toEqual({ ok: false, reason: 'empty' })
    expect(await sendMessengerReply(12, 'x'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('outside the Messenger rollout nothing is read or sent', async () => {
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = '999'
    expect(await sendMessengerReply(12, 'היי')).toEqual({ ok: false, reason: 'not_enabled' })
    expect(h.state.wheres).toHaveLength(0)
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = '103'
  })
})

describe('lead association', () => {
  it('linking goes through getLeadById (agency + rep permissions); a lead the rep cannot see is not linked', async () => {
    vi.mocked(getLeadById).mockResolvedValueOnce(null)
    expect(await linkMessengerConversationToLead(12, 555)).toEqual({ ok: false, reason: 'not_found' })
    expect(h.state.updates).toHaveLength(0)

    vi.mocked(getLeadById).mockResolvedValueOnce({ id: 556 } as never)
    expect(await linkMessengerConversationToLead(12, 556)).toEqual({ ok: true, leadId: 556 })
    expect(h.state.updates).toContainEqual({ table: 'messenger_conversations', u: expect.objectContaining({ leadId: 556 }) })
  })

  it('create lead uses the public upsertLead with a Page-scoped leadSource and the contact\'s name — no invented phone/email', async () => {
    vi.mocked(upsertLead).mockResolvedValueOnce({ id: 900 } as never)
    expect(await createLeadFromMessengerConversation(12)).toEqual({ ok: true, leadId: 900 })
    const [, data, , , origin] = vi.mocked(upsertLead).mock.calls[0]
    // status/userId explicit: the column defaults ('true', NULL) hide the ליד from every לידים tab and rep filter.
    expect(data).toEqual({ firstName: 'דנה', lastName: 'לוי', leadSource: 'messenger:103:PAGE1:PSID-1', lead: true, status: 'new', userId: 7, handlerId: 7 })
    expect(origin).toBe('manual')
  })

  it('an already-linked conversation returns its lead instead of creating another', async () => {
    h.state.conversation!.leadId = 321
    expect(await createLeadFromMessengerConversation(12)).toEqual({ ok: true, leadId: 321 })
    expect(upsertLead).not.toHaveBeenCalled()
  })
})
