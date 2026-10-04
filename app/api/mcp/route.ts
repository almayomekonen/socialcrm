import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { authenticateMcpRequest, type McpAuthResult } from '@/lib/mcp/auth'
import { bearerChallenge } from '@/lib/mcp/wwwAuthenticate'
import { buildMcpServer } from '@/lib/mcp/server'

/**
 * The MCP endpoint: stateless Streamable HTTP, JSON responses, one server per
 * request, no session state.
 *
 *   MCP off                    → 404
 *   Authorization present      → authenticateMcpRequest (Task 11); missing/invalid
 *                                → HTTP 401 + WWW-Authenticate (invalid_token)
 *   no Authorization           → served with no principal: initialize and
 *                                tools/list work; a protected tool returns its
 *                                error with _meta["mcp/www_authenticate"]
 *   feature / product refusals → structured tool errors (audited)
 *
 * No `export const runtime` (cacheComponents rejects it). POST is never prerendered.
 */
const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(req: Request): Promise<Response> {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE })
  const requestId = randomUUID()

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 400, headers: NO_STORE },
    )
  }

  let auth: McpAuthResult = { ok: false, kind: 'missing' }
  if (req.headers.has('authorization')) {
    auth = await authenticateMcpRequest(req, requestId)
    if (!('principal' in auth) && auth.kind === 'disabled') {
      return new NextResponse(null, { status: 404, headers: NO_STORE })
    }
    if (!('principal' in auth) && (auth.kind === 'invalid' || auth.kind === 'missing')) {
      return NextResponse.json(
        { error: 'invalid_token' },
        {
          status: 401,
          headers: {
            ...NO_STORE,
            'www-authenticate': bearerChallenge({
              error: 'invalid_token',
              description: 'Missing, expired or revoked access token',
            }),
          },
        },
      )
    }
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const server = buildMcpServer(auth, requestId)
    await server.connect(transport)
    return await transport.handleRequest(req, { parsedBody })
  } catch (e) {
    console.error('[mcp] request failed', { requestId, error: (e as Error)?.name })
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
      { status: 500, headers: NO_STORE },
    )
  }
}

const notAllowed = () => new NextResponse(null, { status: 405, headers: { allow: 'POST', ...NO_STORE } })
export async function GET(): Promise<Response> {
  return notAllowed()
}
export async function DELETE(): Promise<Response> {
  return notAllowed()
}
