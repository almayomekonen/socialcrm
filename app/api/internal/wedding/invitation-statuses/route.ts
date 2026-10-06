import { NextRequest, NextResponse } from 'next/server'
import { verifyIntegrationRequest } from '@/lib/weddingRsvp/integrationAuth'
import { invitationStatuses, parseStatusQuery } from '@/lib/weddingRsvp/integration'

/**
 * Wedding Manager → SocialCRM: current delivery status (+ RSVP) for up to 200
 * invitations / phones. Read-only. Contract: integration-contract.md §2.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const auth = verifyIntegrationRequest(raw, req.headers.get('x-wedding-timestamp'), req.headers.get('x-wedding-signature'))
  if (auth.ok === false) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const query = parseStatusQuery(auth.body)
  if (!query) return NextResponse.json({ error: 'invalid-input' }, { status: 400 })

  return NextResponse.json(await invitationStatuses(query))
}
