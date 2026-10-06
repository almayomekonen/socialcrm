import { NextRequest, NextResponse } from 'next/server'
import { integrationSendEnabled, verifyIntegrationRequest } from '@/lib/weddingRsvp/integrationAuth'
import { parseSendInput, sendInvitationViaIntegration } from '@/lib/weddingRsvp/integration'

/**
 * Wedding Manager → SocialCRM: send ONE `wedding_invite` (server-to-server, HMAC).
 * Contract: wedding-manager/docs/integration-contract.md §1.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const auth = verifyIntegrationRequest(raw, req.headers.get('x-wedding-timestamp'), req.headers.get('x-wedding-signature'))
  if (auth.ok === false) return NextResponse.json({ accepted: false, error: auth.error }, { status: auth.status })
  // Read-only phase: authenticated, but sending is not switched on. Nothing is sent or written.
  if (!integrationSendEnabled()) return NextResponse.json({ accepted: false, error: 'sending-disabled' }, { status: 503 })

  const input = parseSendInput(auth.body)
  if (!input) return NextResponse.json({ accepted: false, error: 'invalid-input' }, { status: 400 })

  const result = await sendInvitationViaIntegration(input)
  return NextResponse.json(result.body, { status: result.httpStatus })
}
