import { NextRequest, NextResponse } from 'next/server'
import { verifyIntegrationRequest } from '@/lib/weddingRsvp/integrationAuth'
import { exportInvitedGuests } from '@/lib/weddingRsvp/integrationExport'

/**
 * Wedding Manager → SocialCRM: read-only export of everyone already invited
 * (template sends and phone-sent invites), for the Wedding Manager's backfill
 * dry run. Contract: integration-contract.md §3.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const auth = verifyIntegrationRequest(raw, req.headers.get('x-wedding-timestamp'), req.headers.get('x-wedding-signature'))
  if (auth.ok === false) return NextResponse.json({ error: auth.error }, { status: auth.status })
  return NextResponse.json({ generatedAt: new Date().toISOString(), guests: await exportInvitedGuests() })
}
