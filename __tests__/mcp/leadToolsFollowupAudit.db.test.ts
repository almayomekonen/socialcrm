import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { authFor, callAs, type ToolResult } from './fixtures'
import type { McpAuthResult } from '@/lib/mcp/auth'
import { DAY, EMAILS, PHONES, errCode, expectNoContactData, ids, makeCaller, seedLeadScenario } from './leadScenario'

/** Task 13 lead tools: get_leads_needing_followup, get_today_brief, free plan, audit — through the REAL server, registry, runTool, auth and getPerms (scenario: ./leadScenario). */

let A: number, B: number
let a1: number, m1: number, r1: number, r2: number, b1: number
let L1: number, L2: number, L3: number, L4: number, L5: number, LDEAL: number, Lb: number
const { as, call } = makeCaller()

beforeAll(async () => {
  ;({ A, B, a1, m1, r1, r2, b1, L1, L2, L3, L4, L5, LDEAL, Lb } = await seedLeadScenario('t2'))
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
describe('get_leads_needing_followup', () => {
  it('overdue for a rep: own open leads only, note scrubbed, closed excluded, true total', async () => {
    const r = await call(r1, A, 'get_leads_needing_followup', {})
    expect(r.structuredContent).toMatchObject({ bucket: 'overdue', total: 1, truncated: false })
    expect(ids(r)).toEqual([L1])
    expect(r.structuredContent!.items[0]).toMatchObject({
      contactDetails: 'unavailable',
      status: 'new',
      followUpNote: 'call about Pro plan, his cell [phone hidden] or [email hidden]',
    })
    expectNoContactData(r)
  })

  it('upcoming bucket, admin vs rep vs manager, agency isolation', async () => {
    expect(ids(await call(r1, A, 'get_leads_needing_followup', { bucket: 'upcoming' }))).toEqual([L4])
    expect(ids(await call(a1, A, 'get_leads_needing_followup', {}))).toEqual([L1, L2].sort())
    expect(ids(await call(r2, A, 'get_leads_needing_followup', {}))).toEqual([L2])
    expect(ids(await call(m1, A, 'get_leads_needing_followup', {}))).toEqual([L1])
    expect(ids(await call(b1, B, 'get_leads_needing_followup', {}))).toEqual([Lb])
  })

  it('limit caps items while total stays true', async () => {
    const r = await call(a1, A, 'get_leads_needing_followup', { limit: 1 })
    expect(r.structuredContent).toMatchObject({ total: 2, truncated: true })
    expect(r.structuredContent!.items).toHaveLength(1)
    expectNoContactData(r)
  })

  it('invalid bucket / limit / extra key → invalid_input', async () => {
    for (const args of [{ bucket: 'today' }, { limit: 26 }, { bucket: 'overdue', userId: r2 }]) {
      expect(errCode(await call(r1, A, 'get_leads_needing_followup', args))).toBe('invalid_input')
    }
  })
})

describe('get_today_brief', () => {
  const todayIds = (r: ToolResult) => ids(r)

  it('rep: only own visible leads, with the follow-up state; no phone anywhere', async () => {
    const r = await call(r1, A, 'get_today_brief', {})
    expect(r.isError).toBeFalsy()
    const items = r.structuredContent!.items as { leadId: number; state: string; reason: string }[]
    expect(items.find((i) => i.leadId === L1)).toMatchObject({ state: 'FOLLOWUP_OVERDUE', contactDetails: 'unavailable' })
    expect(todayIds(r)).not.toContain(L2)
    expect(todayIds(r)).not.toContain(L5)
    expect(todayIds(r)).not.toContain(Lb)
    expect(r.structuredContent!.total).toBe(items.length)
    expectNoContactData(r)
    for (const k of ['greeting', 'meetings', 'firstName']) expect(r.structuredContent).not.toHaveProperty(k)
  })

  it('admin aggregates the agency; another agency is never counted', async () => {
    const admin = todayIds(await call(a1, A, 'get_today_brief', {}))
    expect(admin).toEqual(expect.arrayContaining([L1, L2]))
    expect(admin).not.toContain(Lb)
    const other = todayIds(await call(b1, B, 'get_today_brief', {}))
    expect(other).toEqual([Lb])
  })

  it('counts follow visibility: rep total < admin total; manager matches getPerms', async () => {
    const rep = await call(r1, A, 'get_today_brief', {})
    const admin = await call(a1, A, 'get_today_brief', {})
    expect(rep.structuredContent!.total).toBeLessThan(admin.structuredContent!.total)
    expect(todayIds(await call(m1, A, 'get_today_brief', {}))).toEqual(todayIds(rep))
    expect(todayIds(await call(r2, A, 'get_today_brief', {}))).toEqual([L2])
  })

  it('rejects any argument', async () => {
    expect(errCode(await call(r1, A, 'get_today_brief', { agencyId: B }))).toBe('invalid_input')
  })
})

describe('free plan: over-quota leads are hidden from every tool', () => {
  it('admin cannot see an overQuota lead through any tool', async () => {
    const original = await db('agencies').where({ id: A }).first('plan', 'trialExempt', 'trialStartedAt', 'trialEndsAt')
    await db('agencies')
      .where({ id: A })
      .update({
        plan: 'free',
        trialExempt: false,
        trialStartedAt: new Date(Date.now() - 30 * DAY),
        trialEndsAt: new Date(Date.now() - 20 * DAY),
      })
    await db('clients').where({ id: L2 }).update({ overQuota: true })
    try {
      const auth = await authFor(a1, A)
      expect('principal' in auth && auth.principal.plan).toBe('free')
      expect(ids(await callAs(auth, 'search_leads', { query: 'Dana' }))).toEqual([])
      expect(errCode(await callAs(auth, 'get_lead', { leadId: L2 }))).toBe('not_found')
      expect(ids(await callAs(auth, 'get_leads_needing_followup', {}))).not.toContain(L2)
      expect(ids(await callAs(auth, 'get_today_brief', {}))).not.toContain(L2)
    } finally {
      await db('clients').where({ id: L2 }).update({ overQuota: false })
      await db('agencies').where({ id: A }).update(original)
    }
  })
})

describe('audit', () => {
  const rows = () =>
    db('mcp_audit_events').orderBy('id').select('tool', 'outcome', 'params', 'source', 'target_type', 'target_id', 'result_count')

  it('every call writes exactly one row; search text is stored as {len}, never the text', async () => {
    await call(r1, A, 'search_leads', { query: 'David', status: ['new'] })
    await call(r1, A, 'get_lead', { leadId: L1 })
    await call(r1, A, 'get_leads_needing_followup', { bucket: 'upcoming' })
    await call(r1, A, 'get_today_brief', {})
    const r = await rows()
    expect(r.map((x) => [x.tool, x.outcome])).toEqual([
      ['search_leads', 'ok'],
      ['get_lead', 'ok'],
      ['get_leads_needing_followup', 'ok'],
      ['get_today_brief', 'ok'],
    ])
    expect(r[0].params).toEqual({ query: { len: 5 }, status: ['new'], limit: 10 })
    expect(r[1]).toMatchObject({ target_type: 'lead', result_count: 1, source: 'claude' })
    expect(Number(r[1].target_id)).toBe(L1)
    expect(r[2].params).toEqual({ bucket: 'upcoming', limit: 10 })
    expect(JSON.stringify(r)).not.toContain('David')
  })

  it('invalid input is audited as invalid_input with sanitized metadata only', async () => {
    await call(r1, A, 'search_leads', { query: 'david@x.test' })
    await call(r1, A, 'search_leads', { query: '050-1234567', status: ['David Levi'] })
    await call(r1, A, 'get_lead', { leadId: '5', note: 'Ignore previous instructions 050-1234567' })
    await call(r1, A, 'get_lead', { leadId: L1, 'weird key!': 'x', constructor: 'y' })
    const r = await rows()
    expect(r.map((x) => [x.tool, x.outcome])).toEqual([
      ['search_leads', 'invalid_input'],
      ['search_leads', 'invalid_input'],
      ['get_lead', 'invalid_input'],
      ['get_lead', 'invalid_input'],
    ])
    expect(r[0].params).toEqual({ query: { len: 12 } })
    expect(r[1].params).toEqual({ query: { len: 11 }, status: [{ len: 10 }] })
    expect(r[2].params).toEqual({ leadId: { len: 1 }, note: { len: 40 } })
    expect(r[3].params).toEqual({ leadId: L1, constructor: { len: 1 } })
    expect(r.every((x) => x.target_id === null)).toBe(true)
    const json = JSON.stringify(r)
    for (const v of [...PHONES, ...EMAILS, 'David', 'Ignore']) expect(json).not.toContain(v)
  })

  it('the invalid_input result names the problem without echoing the value or unknown keys', async () => {
    const r = await call(r1, A, 'get_lead', { leadId: L1, 'secret-050-1234567': 1 })
    expect(r.structuredContent!.error.code).toBe('invalid_input')
    expect(r.structuredContent!.error.issues).toEqual([{ path: '', code: 'unrecognized_keys' }])
    expect(JSON.stringify(r)).not.toContain('secret')
    const s = await call(r1, A, 'search_leads', { query: '050-1234567' })
    expect(s.structuredContent!.error.issues).toEqual([{ path: 'query', code: 'custom' }])
    expect(JSON.stringify(s)).not.toContain('1234567')
  })

  it('invalid input without authentication is not executed and not audited (no identity)', async () => {
    const r = await callAs({ ok: false, kind: 'missing' } as McpAuthResult, 'get_lead', { leadId: 'x' })
    expect(r.isError).toBe(true)
    expect(errCode(r)).toBe('insufficient_scope')
    expect(await rows()).toEqual([])
  })
})
