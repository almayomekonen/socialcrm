import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { parseOAuthForm, OPAQUE_TOKEN_RE } from '@/lib/oauth/server/tokenEndpoint'
import { revokeRefreshFamilyByToken } from '@/lib/oauth/server/refreshTokens'

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

/**
 * RFC 7009 token revocation.
 *
 * A known refresh token revokes its family. Unknown tokens, repeats and any
 * token_type_hint all get the same empty 200, so the endpoint never reveals
 * whether a token existed. Access tokens are not stored and cannot be revoked
 * individually: they live 15 minutes, and every MCP request re-checks the
 * grant, so disconnecting the grant stops them immediately.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE })
  try {
    const parsed = parseOAuthForm({
      contentType: req.headers.get('content-type'),
      hasAuthorizationHeader: req.headers.has('authorization'),
      body: await req.text(),
    })
    if ('outcome' in parsed) {
      const headers: Record<string, string> = { ...NO_STORE }
      if (parsed.outcome.basicChallenge) headers['www-authenticate'] = 'Basic realm="SocialCRM"'
      return NextResponse.json(parsed.outcome.body, { status: parsed.outcome.status, headers })
    }
    const token = parsed.form.get('token')
    if (!token) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'token required' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (OPAQUE_TOKEN_RE.test(token)) await revokeRefreshFamilyByToken(token)
    return new NextResponse(null, { status: 200, headers: NO_STORE })
  } catch (e) {
    console.error('[oauth/revoke] failed', { reason: (e as Error)?.message })
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
