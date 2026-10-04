import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { connectTools } from './fixtures'
import { errCode, expectNoContactData, ids, makeCaller, seedLeadScenario } from './leadScenario'

/** Task 13 lead tools: tools/list, search_leads, get_lead — through the REAL server, registry, runTool, auth and getPerms (scenario: ./leadScenario). */

let A: number, B: number
let a1: number, m1: number, r1: number, r2: number, b1: number
let L1: number, L2: number, L3: number, L4: number, L5: number, LDEAL: number, Lb: number
const { as, call } = makeCaller()

beforeAll(async () => {
  ;({ A, B, a1, m1, r1, r2, b1, L1, L2, L3, L4, L5, LDEAL, Lb } = await seedLeadScenario('t1'))
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
  it('lists the four read-only lead tools with scope metadata', async () => {
    const LEAD_TOOLS = ['get_lead', 'get_leads_needing_followup', 'get_today_brief', 'search_leads']
    const c = await connectTools(await as(r1, A))
    const all = (await c.listTools()).tools
    await c.close()
    const tools = all.filter((t) => LEAD_TOOLS.includes(t.name))
    expect(tools.map((t) => t.name).sort()).toEqual(LEAD_TOOLS)
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
      expect(t._meta).toEqual({ securitySchemes: [{ type: 'oauth2', scopes: ['crm.leads.read'] }] })
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(t.outputSchema).toBeDefined()
    }
  })
})

describe('search_leads', () => {
  it('rep: finds own visible lead by name; other reps, other agencies and deals are excluded', async () => {
    const r = await call(r1, A, 'search_leads', { query: 'David' })
    expect(r.isError).toBeFalsy()
    expect(ids(r)).toEqual([L1, L5].sort())
    expectNoContactData(r)
  })

  it('admin sees the whole agency, never another agency', async () => {
    expect(ids(await call(a1, A, 'search_leads', { query: 'David' }))).toEqual([L1, L5].sort())
    expect(ids(await call(a1, A, 'search_leads', { query: 'Dana' }))).toEqual([L2])
    expect(ids(await call(b1, B, 'search_leads', { query: 'David' }))).toEqual([Lb])
  })

  it('rep cannot see another rep’s lead (identical to no match)', async () => {
    const r = await call(r1, A, 'search_leads', { query: 'Dana' })
    expect(r.structuredContent).toEqual({ items: [], truncated: false })
  })

  it('manager sees exactly what getPerms grants (team member r1, not r2)', async () => {
    expect(ids(await call(m1, A, 'search_leads', { query: 'David' }))).toEqual([L1, L5].sort())
    expect(ids(await call(m1, A, 'search_leads', { query: 'Dana' }))).toEqual([])
  })

  it('status filter, alone and with a name; multi-word names match both terms', async () => {
    expect(ids(await call(a1, A, 'search_leads', { status: ['interested'] }))).toEqual([L2])
    expect(ids(await call(r1, A, 'search_leads', { status: ['interested'] }))).toEqual([])
    expect(ids(await call(r1, A, 'search_leads', { query: 'David', status: ['closed'] }))).toEqual([L5])
    expect(ids(await call(r1, A, 'search_leads', { query: 'David Levi' }))).toEqual([L1])
  })

  it('item shape: status, Hebrew label, owner, url, contactDetails unavailable; legacy status → null', async () => {
    const r = await call(r1, A, 'search_leads', { query: 'Levi' })
    expect(r.structuredContent!.items[0]).toEqual({
      leadId: L1,
      name: 'David Levi',
      url: `https://crm.test/clients/${L1}`,
      contactDetails: 'unavailable',
      status: 'new',
      statusLabel: 'חדש',
      ownerName: 'Rina Rep',
      nextFollowUpAt: expect.any(String),
      lastActivityAt: expect.any(String),
    })
    const legacy = await call(r1, A, 'search_leads', { query: 'Legacy' })
    expect(legacy.structuredContent!.items[0]).toMatchObject({ leadId: L3, status: null, statusLabel: null })
  })

  it('no reverse lookup: phone digits and emails are refused as input, never matched', async () => {
    for (const query of ['1234567', '050-1234567', '0501234567', '972501234567', 'david@x.test', 'noa@x.test']) {
      for (const [u, ag] of [
        [r1, A],
        [a1, A],
      ] as const) {
        const r = await call(u, ag, 'search_leads', { query })
        expect(errCode(r)).toBe('invalid_input')
        expect(JSON.stringify(r)).not.toContain(query)
      }
    }
  })

  it('a name fragment matching inside a phone column finds nothing (phone is never searched)', async () => {
    // "1234" is allowed (≤4 digits) and is part of L1's phone, but not of any name.
    expect(ids(await call(a1, A, 'search_leads', { query: '1234' }))).toEqual([])
  })

  it('LIKE wildcards are literal', async () => {
    expect(ids(await call(a1, A, 'search_leads', { query: '%' }))).toEqual([])
    expect(ids(await call(a1, A, 'search_leads', { query: '_' }))).toEqual([])
  })

  it('limit is enforced: max 25, default 10, truncated when more exist', async () => {
    expect(errCode(await call(a1, A, 'search_leads', { query: 'x', limit: 26 }))).toBe('invalid_input')
    expect(errCode(await call(a1, A, 'search_leads', { query: 'x', limit: 0 }))).toBe('invalid_input')
    const r = await call(a1, A, 'search_leads', { status: ['new', 'contacted', 'interested', 'closed'], limit: 2 })
    expect(r.structuredContent!.items).toHaveLength(2)
    expect(r.structuredContent!.truncated).toBe(true)
  })

  it('invalid input: missing both filters, unknown field, invented status, oversize/control-character query', async () => {
    for (const args of [
      {},
      { query: 'David', agencyId: B },
      { status: ['qualified'] },
      { status: ['won'] },
      { query: 'x'.repeat(81) },
      { query: 'Da\u0000vid' },
      { query: 5 },
    ]) {
      expect(errCode(await call(r1, A, 'search_leads', args))).toBe('invalid_input')
    }
  })
})

describe('get_lead', () => {
  it('visible lead: safe fields only, notes scrubbed, contact details unavailable', async () => {
    const r = await call(r1, A, 'get_lead', { leadId: L1 })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toEqual({
      leadId: L1,
      name: 'David Levi',
      url: `https://crm.test/clients/${L1}`,
      contactDetails: 'unavailable',
      status: 'new',
      statusLabel: 'חדש',
      source: 'whatsapp',
      ownerName: 'Rina Rep',
      createdAt: expect.any(String),
      statusChangedAt: expect.any(String),
      lastActivityAt: expect.any(String),
      nextFollowUpAt: expect.any(String),
      followUpNote: 'call about Pro plan, his cell [phone hidden] or [email hidden]',
      lastOutcome: 'דיברנו',
      hasWhatsappConversation: false,
      contactDetailsNote: expect.stringContaining('intentionally not shared'),
    })
    expectNoContactData(r)
  })

  it('another rep’s lead, another agency’s lead, a deal and a missing id are all the same not_found', async () => {
    const results = [
      await call(r1, A, 'get_lead', { leadId: L2 }),
      await call(a1, A, 'get_lead', { leadId: Lb }),
      await call(r1, A, 'get_lead', { leadId: LDEAL }),
      await call(r1, A, 'get_lead', { leadId: 999999 }),
    ]
    for (const r of results) {
      expect(r.isError).toBe(true)
      expect(r.structuredContent!.error).toMatchObject({
        code: 'not_found',
        message: 'No matching record was found that this user is allowed to see.',
      })
      expect(Object.keys(r.structuredContent!.error).sort()).toEqual(['code', 'message', 'requestId'])
    }
  })

  it('admin and the owning rep both see it; legacy status → null', async () => {
    expect((await call(a1, A, 'get_lead', { leadId: L2 })).structuredContent).toMatchObject({ leadId: L2, status: 'interested' })
    expect((await call(r2, A, 'get_lead', { leadId: L2 })).structuredContent).toMatchObject({ leadId: L2 })
    expect((await call(r1, A, 'get_lead', { leadId: L3 })).structuredContent).toMatchObject({ status: null, statusLabel: null })
  })

  it('hasWhatsappConversation reflects a thread in the same agency (its identifiers are never returned)', async () => {
    await db('inbox_conversations').insert({
      agencyId: A,
      leadId: L4,
      businessPhoneNumberId: 'bpn-1',
      customerWaId: '972501234567',
    })
    const r = await call(r1, A, 'get_lead', { leadId: L4 })
    expect(r.structuredContent).toMatchObject({ hasWhatsappConversation: true, source: 'manual' })
    expectNoContactData(r)
    expect(JSON.stringify(r)).not.toContain('bpn-1')
  })

  it('invalid ids are invalid_input, including a string, zero, negative, float and an extra key', async () => {
    for (const args of [{ leadId: '5' }, { leadId: 0 }, { leadId: -1 }, { leadId: 1.5 }, { leadId: L1, agencyId: B }, {}]) {
      expect(errCode(await call(r1, A, 'get_lead', args))).toBe('invalid_input')
    }
  })
})
