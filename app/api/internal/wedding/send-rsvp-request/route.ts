import { NextRequest, NextResponse } from 'next/server'
import { integrationRsvpSendEnabled, verifyIntegrationRequest } from '@/lib/weddingRsvp/integrationAuth'
import { parseRsvpRequestInput, sendRsvpRequestViaIntegration } from '@/lib/weddingRsvp/integrationRsvp'

/**
 * Wedding Manager → SocialCRM: send ONE approved `wedding_rsvp` template to an
 * invited guest (server-to-server, HMAC). Purpose-specific: no template name, body
 * or Meta payload is accepted from the caller.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const auth = verifyIntegrationRequest(raw, req.headers.get('x-wedding-timestamp'), req.headers.get('x-wedding-signature'))
  if (auth.ok === false) return NextResponse.json({ accepted: false, error: auth.error }, { status: auth.status })
  // Its own switch, separate from invitations. Off unless explicitly enabled.
  if (!integrationRsvpSendEnabled()) return NextResponse.json({ accepted: false, error: 'rsvp-sending-disabled' }, { status: 503 })

  const input = parseRsvpRequestInput(auth.body)
  if (!input) return NextResponse.json({ accepted: false, error: 'invalid-input' }, { status: 400 })

  const result = await sendRsvpRequestViaIntegration(input)
  return NextResponse.json(result.body, { status: result.httpStatus })
}
