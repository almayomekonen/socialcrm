import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('@/lib/mcp/auth', () => ({ authenticateMcpRequest: h.authenticate }))

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { db } from '@/config/db'
import { POST, GET, DELETE } from '@/app/api/mcp/route'
import { buildMcpServer, SERVER_INSTRUCTIONS, type McpToolDef } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { upsertActiveGrant } from '@/lib/oauth/server/grants'
import type { McpAuthResult } from '@/lib/mcp/auth'
import type { McpPrincipal } from '@/lib/mcp/scope'

const CLIENT = 'https://chatgpt.com/oauth/client.json'
const PRM = 'https://crm.test/.well-known/oauth-protected-resource/api/mcp'
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } },
}
let agencyId: number
let userId: number
let grantId: number

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('https://crm.test/api/mcp', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    }),
  )
}

/** A test-only tool so the registry wiring is exercised without committing a real or temporary tool. */
const FAKE: McpToolDef = {
  name: 'fake_read',
  title: 'Fake read',
  description: 'Test-only tool.',
  scope: 'crm.leads.read',
  inputSchema: z.object({ n: z.number().int().optional() }).strict(),
  outputSchema: z.object({ ok: z.literal(true), userId: z.number() }),
  run: async (p) => ({ data: { ok: true, userId: p.userId }, resultCount: 0 }),
}

async function client(auth: McpAuthResult, tools: McpToolDef[] = [FAKE]) {
  const server = buildMcpServer(auth, '44444444-4444-4444-8444-444444444444', tools)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), c.connect(b)])
  return c
}
const principal = (): McpPrincipal => ({
  requestId: '44444444-4444-4444-8444-444444444444',
  userId,
  agencyId,
  role: 'AGNT' as McpPrincipal['role'],
  firstName: 'Rina',
  gotPermIds: [userId],
  plan: 'pro',
  grantId,
  clientId: CLIENT,
  scopes: ['crm.leads.read', 'crm.conversations.read'],
})

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__mcp_endpoint__' }).returning('id')
  agencyId = a.id
  const [u] = await db('users').insert({ firstName: 'Rina', role: 'AGNT', agencyId }).returning('id')
  userId = u.id
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('MCP_ENABLED', '1')
  await db.raw(
    'TRUNCATE mcp_audit_events, oauth_refresh_tokens, oauth_authorization_codes, oauth_grants RESTART IDENTITY CASCADE',
  )
  grantId = (
    await upsertActiveGrant({
      userId,
      agencyId,
      clientId: CLIENT,
      clientName: 'ChatGPT',
      resource: 'https://crm.test/api/mcp',
      scopes: ['crm.leads.read'],
      sessionVersion: 0,
    })
  ).id
})
afterAll(async () => {
  await db.destroy()
})

describe('POST /api/mcp — HTTP layer', () => {
  it('404 while MCP is disabled (no auth attempted)', async () => {
    vi.stubEnv('MCP_ENABLED', '')
    expect((await rpc(INIT)).status).toBe(404)
    expect(h.authenticate).not.toHaveBeenCalled()
  })

  it('GET and DELETE are not supported (stateless JSON server)', async () => {
    for (const handler of [GET, DELETE]) {
      const res = await handler()
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    }
  })

  it('initialize without a token: 200, server info, tools capability, instructions; no session id', async () => {
    const res = await rpc(INIT)
    expect(res.status).toBe(200)
    expect(res.headers.get('mcp-session-id')).toBeNull()
    const b = await res.json()
    expect(b.result.serverInfo).toMatchObject({ name: 'socialcrm' })
    expect(b.result.capabilities.tools).toBeDefined()
    expect(b.result.instructions).toBe(SERVER_INSTRUCTIONS)
    expect(h.authenticate).not.toHaveBeenCalled()
  })

  it('tools/list without a token is allowed and lists the committed read-only tools', async () => {
    const leadTools = ['search_leads', 'get_lead', 'get_leads_needing_followup', 'get_today_brief']
    const conversationTools = ['get_lead_conversations', 'get_conversation', 'get_unanswered_conversations']
    const names = [...leadTools, ...conversationTools]
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(names)
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(res.status).toBe(200)
    const tools = (await res.json()).result.tools as { name: string; annotations: unknown; _meta: unknown }[]
    expect(tools.map((t) => t.name)).toEqual(names)
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true })
      const scope = leadTools.includes(t.name) ? 'crm.leads.read' : 'crm.conversations.read'
      expect(t._meta).toEqual({ securitySchemes: [{ type: 'oauth2', scopes: [scope] }] })
    }
  })

  it('an empty registry still answers tools/list (server-level handler)', async () => {
    const c = await client({ ok: true, principal: principal() }, [])
    expect((await c.listTools()).tools).toEqual([])
  })

  it('an invalid bearer token → HTTP 401 with an invalid_token challenge naming the PRM', async () => {
    h.authenticate.mockResolvedValue({ ok: false, kind: 'invalid' })
    for (const body of [INIT, { jsonrpc: '2.0', id: 3, method: 'tools/list' }]) {
      const res = await rpc(body, { authorization: 'Bearer nope' })
      expect(res.status).toBe(401)
      const challenge = res.headers.get('www-authenticate')!
      expect(challenge).toContain(`resource_metadata="${PRM}"`)
      expect(challenge).toContain('error="invalid_token"')
      expect(challenge).toContain('error_description=')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('a valid bearer token is authenticated through authenticateMcpRequest with a fresh request id', async () => {
    h.authenticate.mockResolvedValue({ ok: true, principal: principal() })
    await rpc(INIT, { authorization: 'Bearer good' })
    await rpc(INIT, { authorization: 'Bearer good' })
    expect(h.authenticate).toHaveBeenCalledTimes(2)
    const [id1, id2] = h.authenticate.mock.calls.map((c) => c[1] as string)
    expect(id1).toMatch(/^[0-9a-f-]{36}$/)
    expect(id1).not.toBe(id2)
  })

  it('kill switch reported by auth (disabled) → 404', async () => {
    h.authenticate.mockResolvedValue({ ok: false, kind: 'disabled' })
    expect((await rpc(INIT, { authorization: 'Bearer good' })).status).toBe(404)
  })

  it('malformed JSON → 400 JSON-RPC parse error', async () => {
    const res = await rpc('{not json')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32700)
  })
})

describe('tool registry wiring (test-only tool)', () => {
  it('tools/list descriptor: name, description, read-only annotations, schemas and _meta.securitySchemes', async () => {
    const c = await client({ ok: false, kind: 'missing' })
    const { tools } = await c.listTools()
    expect(tools).toHaveLength(1)
    const t = tools[0]
    expect(t).toMatchObject({
      name: 'fake_read',
      title: 'Fake read',
      description: 'Test-only tool.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['crm.leads.read'] }] },
    })
    expect(t.inputSchema.type).toBe('object')
    expect(t.outputSchema?.type).toBe('object')
  })

  it('an unauthenticated call returns the tool error with _meta["mcp/www_authenticate"]', async () => {
    const c = await client({ ok: false, kind: 'missing' })
    const r = await c.callTool({ name: 'fake_read', arguments: {} })
    expect(r.isError).toBe(true)
    const challenge = (r._meta as Record<string, string[]>)['mcp/www_authenticate'][0]
    expect(challenge).toContain('error="invalid_token"')
    expect(challenge).toContain(`resource_metadata="${PRM}"`)
    expect(challenge).toContain('scope="crm.leads.read"')
    expect(await db('mcp_audit_events')).toHaveLength(0)
  })

  it('an authenticated call runs through runTool: result + one audit row', async () => {
    const c = await client({ ok: true, principal: principal() })
    const r = await c.callTool({ name: 'fake_read', arguments: { n: 3 } })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toEqual({ ok: true, userId })
    const rows = await db('mcp_audit_events').select('tool', 'outcome', 'params', 'grant_id')
    expect(rows).toEqual([{ tool: 'fake_read', outcome: 'ok', params: { n: 3 }, grant_id: String(grantId) }])
  })

  it('a principal without the scope gets insufficient_scope, audited', async () => {
    const p = { ...principal(), scopes: ['crm.conversations.read' as const] }
    const c = await client({ ok: true, principal: p })
    const r = await c.callTool({ name: 'fake_read', arguments: {} })
    expect((r.structuredContent as { error: { code: string } }).error.code).toBe('insufficient_scope')
    expect((await db('mcp_audit_events').first('outcome')).outcome).toBe('insufficient_scope')
  })
})
