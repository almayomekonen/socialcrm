import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { connectTools, seedUser, type ToolResult } from './fixtures'
import { errCode, makeCaller } from './leadScenario'
import { BPN, WA_ID, seedConversationScenario } from './conversationScenario'

/** Task 14 conversation tools — permissions, shapes, caps and PII, through the real server. */

let S: Awaited<ReturnType<typeof seedConversationScenario>>
let a1: number, m1: number, r1: number, r2: number, b1: number, g1: number, o1: number, e1: number
let A: number, B: number
const { call } = makeCaller()
const NOT_FOUND = 'No matching record was found that this user is allowed to see.'

const convIds = (r: ToolResult) =>
  (r.structuredContent?.items as { conversationId: number }[]).map((i) => i.conversationId).sort((x, y) => x - y)
const sorted = (...xs: number[]) => [...xs].sort((x, y) => x - y)

function expectNoIdentifiers(r: ToolResult) {
  const json = JSON.stringify(r)
  for (const v of [WA_ID, BPN, '050-1234567', '0501234567', '0529876543', 'david@x.test', 'wamid', 's.whatsapp.net'])
    expect(json).not.toContain(v)
  expect(json).not.toMatch(
    /"(phone|email|customerWaId|businessPhoneNumberId|fromId|toId|payload|rawPayload|metadata|externalId|lastMessageText)"\s*:/,
  )
}

beforeAll(async () => {
  S = await seedConversationScenario('c1')
  ;({ A, B, a1, m1, r1, r2, b1, g1, o1 } = S)
  e1 = await seedUser(A, 'EXT', 'Eli', 'External')
})
beforeEach(async () => {
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', `${A},${B}`)
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  await db('mcp_audit_events').del()
})
afterAll(async () => {
  await db.destroy()
})

describe('tools/list', () => {
  it('seven read-only tools; conversation tools declare crm.conversations.read', async () => {
    const c = await connectTools(await makeCaller().as(r1, A))
    const { tools } = await c.listTools()
    await c.close()
    const scopes = Object.fromEntries(tools.map((t) => [t.name, (t._meta as any).securitySchemes[0].scopes[0]]))
    expect(scopes).toEqual({
      search_leads: 'crm.leads.read',
      get_lead: 'crm.leads.read',
      get_leads_needing_followup: 'crm.leads.read',
      get_today_brief: 'crm.leads.read',
      get_lead_conversations: 'crm.conversations.read',
      get_conversation: 'crm.conversations.read',
      get_unanswered_conversations: 'crm.conversations.read',
    })
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })
})

describe('get_lead_conversations', () => {
  it('visible lead: all its conversations, stored intelligence, no messages, no identifiers', async () => {
    const r = await call(r1, A, 'get_lead_conversations', { leadId: S.L1 })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent!.lead).toMatchObject({ leadId: S.L1, name: 'David Levi', contactDetails: 'unavailable' })
    expect(convIds(r)).toEqual(sorted(S.C1, S.C2, S.CA))
    const c1 = r.structuredContent!.items.find((i: any) => i.conversationId === S.C1)
    expect(c1).toEqual({
      conversationId: S.C1,
      channel: 'whatsapp',
      url: `https://crm.test/inbox?conversation=${S.C1}`,
      state: 'open',
      lastMessageAt: expect.any(String),
      lastInboundAt: expect.any(String),
      waitingForReply: true,
      summary: 'שאל על מחיר תוכנית Pro',
      intent: 'pricing',
      temperature: 'warm',
      intelligenceStatus: 'fresh',
      intelligenceUpdatedAt: expect.any(String),
    })
    expect(JSON.stringify(r.structuredContent)).not.toMatch(/"(messages|text)"\s*:/)
    expectNoIdentifiers(r)
  })

  it('missing intelligence is null/none, never invented; waiting follows the product rule', async () => {
    const r = await call(r1, A, 'get_lead_conversations', { leadId: S.L1 })
    const byId = Object.fromEntries(r.structuredContent!.items.map((i: any) => [i.conversationId, i]))
    expect(byId[S.C2]).toMatchObject({
      summary: null,
      intent: null,
      temperature: null,
      intelligenceStatus: 'none',
      waitingForReply: false,
    })
    expect(byId[S.CA].waitingForReply).toBe(true)
  })

  it('invisible lead, other agency, deal and missing lead are the same not_found', async () => {
    for (const [u, ag, leadId] of [
      [r1, A, S.L2],
      [a1, A, S.Lb],
      [r1, A, S.LDEAL],
      [r1, A, 999999],
    ] as const) {
      const r = await call(u, ag, 'get_lead_conversations', { leadId })
      expect(r.structuredContent!.error).toMatchObject({ code: 'not_found', message: NOT_FOUND })
    }
  })

  it('limit caps the list and says so', async () => {
    const r = await call(r1, A, 'get_lead_conversations', { leadId: S.L1, limit: 2 })
    expect(r.structuredContent!.items).toHaveLength(2)
    expect(r.structuredContent!.truncated).toBe(true)
  })
})

describe('get_conversation — visibility', () => {
  it('linked: owner rep, admin, GM and team manager see it; another rep does not', async () => {
    for (const u of [r1, a1, g1, m1]) {
      const r = await call(u, A, 'get_conversation', { conversationId: S.C1 })
      expect(r.isError).toBeFalsy()
      expect(r.structuredContent!.lead).toMatchObject({ leadId: S.L1 })
    }
    const r = await call(r2, A, 'get_conversation', { conversationId: S.C1 })
    expect(r.structuredContent!.error).toMatchObject({ code: 'not_found', message: NOT_FOUND })
  })

  it('unlinked: ADMIN and GM only; MNGR, AGNT, OFFICE and EXT get not_found', async () => {
    for (const u of [a1, g1]) {
      const r = await call(u, A, 'get_conversation', { conversationId: S.CU })
      expect(r.isError).toBeFalsy()
      expect(r.structuredContent).toMatchObject({ conversationId: S.CU, lead: null, customerName: 'Walk-in [phone hidden]' })
    }
    for (const u of [m1, r1, o1, e1]) {
      const r = await call(u, A, 'get_conversation', { conversationId: S.CU })
      expect(r.isError).toBe(true)
      expect(errCode(r)).toBe('not_found')
    }
  })

  it('other agency, personal thread and missing id are all not_found, even for an admin', async () => {
    for (const conversationId of [S.CB, S.CP, 99999999]) {
      expect(errCode(await call(a1, A, 'get_conversation', { conversationId }))).toBe('not_found')
    }
    expect(errCode(await call(b1, B, 'get_conversation', { conversationId: S.C1 }))).toBe('not_found')
  })
})

describe('get_conversation — customerName exposure', () => {
  const UNLINKED_KEYS = [
    'channel',
    'conversationId',
    'customerName',
    'intelligenceStatus',
    'intelligenceUpdatedAt',
    'intent',
    'lastInboundAt',
    'lastMessageAt',
    'lead',
    'state',
    'summary',
    'temperature',
    'url',
    'waitingForReply',
  ]

  it('a linked conversation never exposes customerName, for any role that can see it, with or without messages', async () => {
    for (const u of [r1, a1, g1, m1]) {
      for (const includeMessages of [false, true]) {
        const r = await call(u, A, 'get_conversation', { conversationId: S.C1, includeMessages })
        expect(r.isError).toBeFalsy()
        expect(r.structuredContent).not.toHaveProperty('customerName')
        expect(JSON.stringify(r)).not.toContain('Profile Name')
      }
    }
  })

  it('unlinked: ADMIN and GM get the masked customerName and nothing else new', async () => {
    for (const u of [a1, g1]) {
      const r = await call(u, A, 'get_conversation', { conversationId: S.CU })
      expect(r.structuredContent!.customerName).toBe('Walk-in [phone hidden]')
      expect(Object.keys(r.structuredContent!).sort()).toEqual(UNLINKED_KEYS)
      expectNoIdentifiers(r)
    }
  })

  it('unlinked: lower roles still cannot open it, so the name never reaches them', async () => {
    for (const u of [m1, r1, o1, e1]) {
      const r = await call(u, A, 'get_conversation', { conversationId: S.CU })
      expect(errCode(r)).toBe('not_found')
      expect(JSON.stringify(r)).not.toContain('Walk-in')
    }
  })

  it('no other conversation tool returns customerName', async () => {
    const lists = [
      await call(a1, A, 'get_lead_conversations', { leadId: S.L1 }),
      await call(a1, A, 'get_unanswered_conversations', {}),
    ]
    for (const r of lists) {
      expect(JSON.stringify(r.structuredContent)).not.toContain('customerName')
      expect(JSON.stringify(r)).not.toContain('Walk-in')
    }
  })
})

describe('get_conversation — messages', () => {
  it('default: metadata and stored intelligence, no messages key at all', async () => {
    const r = await call(r1, A, 'get_conversation', { conversationId: S.C1 })
    expect(r.structuredContent).not.toHaveProperty('messages')
    expect(r.structuredContent).not.toHaveProperty('messagesTruncated')
    expect(r.structuredContent).toMatchObject({ summary: 'שאל על מחיר תוכנית Pro', waitingForReply: true })
    expectNoIdentifiers(r)
  })

  it('includeMessages: customer text masked for phone/email; no sender identifiers or payloads', async () => {
    const r = await call(r1, A, 'get_conversation', { conversationId: S.C1, includeMessages: true })
    expect(r.structuredContent!.messages).toEqual([
      {
        messageId: expect.any(Number),
        author: 'customer',
        type: 'text',
        sentAt: expect.any(String),
        text: 'Hi, how much is the Pro plan? call me [phone hidden] or [email hidden]',
        contentTruncated: false,
      },
    ])
    expect(r.structuredContent!.messagesTruncated).toBe(false)
    expectNoIdentifiers(r)
  })

  it('caps at 50 newest messages, oldest-first, with explicit truncation', async () => {
    const r = await call(r1, A, 'get_conversation', { conversationId: S.CM, includeMessages: true, messageLimit: 50 })
    const msgs = r.structuredContent!.messages as any[]
    expect(msgs).toHaveLength(50)
    expect(r.structuredContent!.messagesTruncated).toBe(true)
    const times = msgs.map((m) => Date.parse(m.sentAt))
    expect([...times].sort((x, y) => x - y)).toEqual(times)
    expect(msgs.at(-1)).toMatchObject({ author: 'business', text: 'hello from Rina' })
    expect(msgs.at(-2)).toMatchObject({ author: 'automation', text: 'automated hello' })
    expect(msgs.at(-3)).toMatchObject({ type: 'contacts', text: null })
    expect(msgs.at(-4).text).toBe('bell and [31mred[0m')
    expect(msgs.at(-5).text).toHaveLength(1000)
    expect(msgs.at(-5).contentTruncated).toBe(true)
    expectNoIdentifiers(r)
    const d = await call(r1, A, 'get_conversation', { conversationId: S.CM, includeMessages: true })
    expect(d.structuredContent!.messages).toHaveLength(20)
  })

  it('invalid: messageLimit 51/0, string id, extra key', async () => {
    for (const args of [
      { conversationId: S.CM, includeMessages: true, messageLimit: 51 },
      { conversationId: S.CM, messageLimit: 0 },
      { conversationId: String(S.C1) },
      { conversationId: S.C1, agencyId: B },
      { conversationId: S.C1, includeMessages: 'yes' },
    ]) {
      expect(errCode(await call(r1, A, 'get_conversation', args))).toBe('invalid_input')
    }
  })
})

describe('get_unanswered_conversations', () => {
  it('rep: own leads only, product waiting rule (human reply ends waiting; automation does not; 14-day window; closed excluded)', async () => {
    const r = await call(r1, A, 'get_unanswered_conversations', {})
    expect(convIds(r)).toEqual(sorted(S.C1, S.CA, S.CI))
    expectNoIdentifiers(r)
  })

  it('minWaitingHours and oldest-first order', async () => {
    const r = await call(a1, A, 'get_unanswered_conversations', { minWaitingHours: 48 })
    expect((r.structuredContent!.items as any[]).map((i) => i.conversationId)).toEqual([S.CU, S.C3, S.C1])
    expect(r.structuredContent!.items[0]).toMatchObject({
      lead: null,
      intent: 'pricing',
      url: `https://crm.test/inbox?conversation=${S.CU}`,
    })
    expect(r.structuredContent!.items[2]).toMatchObject({
      lead: { leadId: S.L1, name: 'David Levi' },
      summary: 'שאל על מחיר תוכנית Pro',
    })
  })

  it('unlinked only for ADMIN/GM; manager, rep, office and EXT never see it; personal never', async () => {
    expect(convIds(await call(g1, A, 'get_unanswered_conversations', { minWaitingHours: 48 }))).toEqual(sorted(S.C1, S.C3, S.CU))
    expect(convIds(await call(m1, A, 'get_unanswered_conversations', { minWaitingHours: 48 }))).toEqual([S.C1])
    for (const u of [r1, r2, o1, e1]) {
      const ids = convIds(await call(u, A, 'get_unanswered_conversations', { minWaitingHours: 48 }))
      expect(ids).not.toContain(S.CU)
      expect(ids).not.toContain(S.CP)
    }
    expect(convIds(await call(r2, A, 'get_unanswered_conversations', {}))).toEqual([S.C3])
  })

  it('intent filter and agency isolation', async () => {
    expect(convIds(await call(a1, A, 'get_unanswered_conversations', { intent: 'pricing' }))).toEqual(sorted(S.C1, S.CU))
    expect(convIds(await call(b1, B, 'get_unanswered_conversations', {}))).toEqual([S.CB])
    expect(errCode(await call(a1, A, 'get_unanswered_conversations', { intent: 'qualified' }))).toBe('invalid_input')
    expect(errCode(await call(a1, A, 'get_unanswered_conversations', { minWaitingHours: 337 }))).toBe('invalid_input')
  })

  it('limit truncates', async () => {
    const r = await call(a1, A, 'get_unanswered_conversations', { limit: 1 })
    expect(r.structuredContent!.items).toHaveLength(1)
    expect(r.structuredContent!.truncated).toBe(true)
  })
})
