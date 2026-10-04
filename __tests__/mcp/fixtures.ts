import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { db } from '@/config/db'
import { authenticateMcpRequest, type McpAuthResult } from '@/lib/mcp/auth'
import { buildMcpServer } from '@/lib/mcp/server'
import { upsertActiveGrant } from '@/lib/oauth/server/grants'
import { signMcpAccessToken } from '@/lib/oauth/server/accessToken'

/**
 * Shared MCP tool-test fixtures. Principals are built by the REAL
 * authenticateMcpRequest on a freshly minted token, so tool tests exercise the
 * real getPerms / plan / scope path. Callers mock only product access.
 */

export const CLAUDE_CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const RESOURCE = 'https://crm.test/api/mcp'
const BOTH = ['crm.leads.read', 'crm.conversations.read']

export async function seedAgency(name: string): Promise<number> {
  const [a] = await db('agencies').insert({ name }).returning('id')
  return Number(a.id)
}

export async function seedUser(
  agencyId: number,
  role: 'ADMIN' | 'GM' | 'MNGR' | 'AGNT' | 'OFFICE' | 'EXT',
  firstName: string,
  lastName = 'Test',
): Promise<number> {
  const [u] = await db('users').insert({ firstName, lastName, role, agencyId }).returning('id')
  return Number(u.id)
}

export async function seedLead(
  agencyId: number,
  ownerId: number,
  firstName: string,
  lastName: string,
  over: Record<string, unknown> = {},
): Promise<number> {
  const [c] = await db('clients')
    .insert({ agencyId, userId: ownerId, createdById: ownerId, firstName, lastName, lead: true, status: 'new', ...over })
    .returning('id')
  return Number(c.id)
}

/** Grant + token + the real authenticateMcpRequest. */
export async function authFor(
  userId: number,
  agencyId: number,
  opts: { scopes?: string[]; clientId?: string } = {},
): Promise<McpAuthResult> {
  const scopes = opts.scopes ?? BOTH
  const clientId = opts.clientId ?? CLAUDE_CLIENT
  const g = await upsertActiveGrant({
    userId,
    agencyId,
    clientId,
    clientName: 'Claude',
    resource: RESOURCE,
    scopes,
    sessionVersion: 0,
  })
  const token = await signMcpAccessToken({ userId, agencyId, grantId: g.id, sessionVersion: 0, scopes, clientId })
  const req = new Request(RESOURCE, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
  return authenticateMcpRequest(req, crypto.randomUUID())
}

/** An SDK client connected in memory to the real server and the real registry. */
export async function connectTools(auth: McpAuthResult): Promise<Client> {
  const requestId = 'principal' in auth ? auth.principal.requestId : crypto.randomUUID()
  const server = buildMcpServer(auth, requestId)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), c.connect(b)])
  return c
}

export type ToolResult = { isError?: boolean; structuredContent?: Record<string, any>; content?: { text?: string }[] }

export async function callAs(auth: McpAuthResult, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const c = await connectTools(auth)
  try {
    return (await c.callTool({ name, arguments: args })) as ToolResult
  } finally {
    await c.close()
  }
}
