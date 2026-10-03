import { NextResponse } from 'next/server'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { handleTokenRequest } from '@/lib/oauth/server/tokenEndpoint'

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

/** OAuth 2.1 token endpoint (authorization_code + refresh_token; public clients only). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!isMcpEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE })
  try {
    const out = await handleTokenRequest({
      contentType: req.headers.get('content-type'),
      hasAuthorizationHeader: req.headers.has('authorization'),
      body: await req.text(),
    })
    const headers: Record<string, string> = { ...NO_STORE }
    if (out.basicChallenge) headers['www-authenticate'] = 'Basic realm="SocialCRM"'
    return NextResponse.json(out.body, { status: out.status, headers })
  } catch (e) {
    console.error('[oauth/token] failed', { reason: (e as Error)?.message })
    return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}
