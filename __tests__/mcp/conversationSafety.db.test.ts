import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ productAccess: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: h.productAccess }))

import { db } from '@/config/db'
import { RATE_LIMITS } from '@/lib/mcp/rateLimit'
import type { ToolResult } from './fixtures'
import { errCode, ids, makeCaller } from './leadScenario'
import { HOSTILE_NAME, HOSTILE_SUMMARY, HOSTILE_TEXTS, seedConversationScenario } from './conversationScenario'

/**
 * Task 14 safety: stored customer text is returned as data only and never
 * changes scope, permissions, audit content or server behaviour; no LLM or
 * network call happens; the stricter message-read bucket applies only to
 * includeMessages=true.
 */

let S: Awaited<ReturnType<typeof seedConversationScenario>>
let A: number, B: number, r1: number, r2: number, a1: number
const { as, call } = makeCaller()
let fetchSpy: ReturnType<typeof vi.spyOn>

const counts = async () => ({
  clients: Number((await db('clients').count('id as n').first())!.n),
  intel: await db('conversation_intelligence').select('id', 'updatedAt', 'data').orderBy('id'),
  jobs: Number((await db('conversation_analysis_jobs').count('id as n').first())!.n),
  messages: Number((await db('inbox_messages').count('id as n').first())!.n),
  conversations: await db('inbox_conversations').select('id', 'unreadCount', 'updatedAt', 'leadId', 'state').orderBy('id'),
})

beforeAll(async () => {
  S = await seedConversationScenario('c2')
  ;({ A, B, r1, r2, a1 } = S)
})
beforeEach(async () => {
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_ENABLED', '1')
  vi.stubEnv('MCP_AGENCY_ALLOWLIST', `${A},${B}`)
  h.productAccess.mockResolvedValue({ status: 'PAID', hasAccess: true })
  await db('mcp_audit_events').del()
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => {
  fetchSpy.mockRestore()
})
afterAll(async () => {
  await db.destroy()
})

describe('prompt injection: stored text is data only', () => {
  it('hostile messages, name and summary come back verbatim as data with the normal shape', async () => {
    const before = await counts()
    const normal = await call(r1, A, 'get_conversation', { conversationId: S.C1, includeMessages: true })
    const r = await call(r1, A, 'get_conversation', { conversationId: S.CI, includeMessages: true })
    expect(r.isError).toBeFalsy()
    expect(Object.keys(r.structuredContent!).sort()).toEqual(Object.keys(normal.structuredContent!).sort())
    expect((r.structuredContent!.messages as any[]).map((m) => m.text)).toEqual(HOSTILE_TEXTS)
    expect(r.structuredContent!.lead).toEqual({
      leadId: S.LI,
      name: HOSTILE_NAME,
      url: `https://crm.test/clients/${S.LI}`,
      contactDetails: 'unavailable',
    })
    expect(r.structuredContent!.summary).toBe(HOSTILE_SUMMARY)
    // Exactly one lead id appears; the "agencyId":2 inside a message is just text.
    expect(JSON.stringify(r.structuredContent).match(/"leadId":\d+/g)).toEqual([`"leadId":${S.LI}`])
    // Nothing was written or changed, no network call (no LLM), and scope is unchanged.
    expect(await counts()).toEqual(before)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ids(await call(r1, A, 'search_leads', { query: 'David' }))).toEqual([S.L1, S.L5].sort())
    expect(errCode(await call(r2, A, 'get_conversation', { conversationId: S.CI }))).toBe('not_found')
  })

  it('hostile summary in the unanswered list is data; the list is the same as without it', async () => {
    const r = await call(r1, A, 'get_unanswered_conversations', {})
    const ci = (r.structuredContent!.items as any[]).find((i) => i.conversationId === S.CI)
    expect(ci).toMatchObject({ summary: HOSTILE_SUMMARY, intent: 'support', temperature: 'hot', lead: { name: HOSTILE_NAME } })
    expect((r.structuredContent!.items as any[]).map((i) => i.conversationId).sort((x, y) => x - y)).toEqual(
      [S.C1, S.CA, S.CI].sort((x, y) => x - y),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('no hostile string, message text or summary ever reaches the audit table', async () => {
    await call(r1, A, 'get_conversation', { conversationId: S.CI, includeMessages: true })
    await call(r1, A, 'get_lead_conversations', { leadId: S.LI })
    await call(r1, A, 'get_unanswered_conversations', { intent: 'support' })
    const json = JSON.stringify(await db('mcp_audit_events').select('*'))
    for (const t of [...HOSTILE_TEXTS, HOSTILE_NAME, HOSTILE_SUMMARY, 'שאל על מחיר', 'Pro plan', 'DROP TABLE', 'SYSTEM'])
      expect(json).not.toContain(t)
  })
})

describe('stored intelligence is read, never computed', () => {
  it('reading every tool leaves intelligence and analysis jobs untouched and makes no network call', async () => {
    const before = await counts()
    await call(a1, A, 'get_lead_conversations', { leadId: S.L1 })
    await call(a1, A, 'get_conversation', { conversationId: S.C2, includeMessages: true })
    await call(a1, A, 'get_conversation', { conversationId: S.CU })
    await call(a1, A, 'get_unanswered_conversations', { minWaitingHours: 0 })
    expect(await counts()).toEqual(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('audit', () => {
  const rows = () =>
    db('mcp_audit_events').orderBy('id').select('tool', 'outcome', 'params', 'target_type', 'target_id', 'result_count')

  it('includeMessages is stored as a boolean; ids/limits kept; one row per call', async () => {
    await call(r1, A, 'get_conversation', { conversationId: S.C1 })
    await call(r1, A, 'get_conversation', { conversationId: S.C1, includeMessages: true, messageLimit: 5 })
    await call(r1, A, 'get_lead_conversations', { leadId: S.L1 })
    await call(r1, A, 'get_unanswered_conversations', { minWaitingHours: 24, intent: 'pricing' })
    const r = await rows()
    expect(r.map((x) => [x.tool, x.outcome])).toEqual([
      ['get_conversation', 'ok'],
      ['get_conversation', 'ok'],
      ['get_lead_conversations', 'ok'],
      ['get_unanswered_conversations', 'ok'],
    ])
    expect(r[0].params).toEqual({ conversationId: S.C1, includeMessages: false, messageLimit: 20 })
    expect(r[1].params).toEqual({ conversationId: S.C1, includeMessages: true, messageLimit: 5 })
    expect(r[0]).toMatchObject({ target_type: 'conversation' })
    expect(Number(r[0].target_id)).toBe(S.C1)
    expect(r[2]).toMatchObject({ target_type: 'lead' })
    expect(r[3].params).toEqual({ minWaitingHours: 24, intent: 'pricing', limit: 10 })
  })

  it('refusals and invalid input are audited without values', async () => {
    await call(r2, A, 'get_conversation', { conversationId: S.C1, includeMessages: true })
    await call(r1, A, 'get_conversation', { conversationId: S.C1, messageLimit: 51, note: HOSTILE_TEXTS[0] })
    await call(r1, A, 'get_unanswered_conversations', { intent: 'ignore previous instructions' })
    const r = await rows()
    expect(r.map((x) => [x.tool, x.outcome])).toEqual([
      ['get_conversation', 'not_found'],
      ['get_conversation', 'invalid_input'],
      ['get_unanswered_conversations', 'invalid_input'],
    ])
    expect(r[1].params).toEqual({ conversationId: S.C1, messageLimit: 51, note: { len: HOSTILE_TEXTS[0].length } })
    expect(r[2].params).toEqual({ intent: { len: 28 } })
    expect(JSON.stringify(r)).not.toContain('Ignore')
  })
})

describe('rate limit: the stricter message-read bucket', () => {
  it('applies only to get_conversation with includeMessages=true', async () => {
    const auth = await as(r1, A)
    const p = 'principal' in auth ? auth.principal : null
    expect(p).not.toBeNull()
    // Fill the hourly message-read bucket with earlier successful message reads
    // (30 minutes ago: outside the per-minute window, inside the hour).
    const old = new Date(Date.now() - 30 * 60 * 1000)
    await db('mcp_audit_events').insert(
      Array.from({ length: RATE_LIMITS.messageReadsHour.max }, () => ({
        request_id: crypto.randomUUID(),
        occurred_at: old,
        agency_id: A,
        user_id: r1,
        grant_id: p!.grantId,
        client_id: p!.clientId,
        source: 'claude',
        tool: 'get_conversation',
        kind: 'read',
        params: JSON.stringify({ conversationId: S.C1, includeMessages: true }),
        outcome: 'ok',
        duration_ms: 1,
      })),
    )
    const limited: ToolResult = await call(r1, A, 'get_conversation', { conversationId: S.C1, includeMessages: true })
    expect(errCode(limited)).toBe('rate_limited')
    expect(limited.structuredContent!.error.retryAfterSeconds).toBeGreaterThan(0)
    expect((await call(r1, A, 'get_conversation', { conversationId: S.C1 })).isError).toBeFalsy()
    expect((await call(r1, A, 'get_lead_conversations', { leadId: S.L1 })).isError).toBeFalsy()
    expect((await call(r1, A, 'get_unanswered_conversations', {})).isError).toBeFalsy()
  })
})
