import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { sendWeddingRsvp } from '@/lib/weddingRsvp/sendRsvp'

/**
 * TEMPORARY — Wedding RSVP (see lib/weddingRsvp/config.ts). Sends the RSVP to
 * exactly ONE conversation of the signed-in user's agency. The recipient must be
 * on the hard allowlist; there is no list or bulk input.
 *
 *   POST /api/wedding-rsvp/send   { "conversationId": 7224 }
 */
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { conversationId?: unknown }
  const conversationId = Number(body.conversationId)
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return NextResponse.json({ error: 'invalid-conversation-id' }, { status: 400 })
  }

  const result = await sendWeddingRsvp({ agencyId: user.agencyId, conversationId, sentByUserId: user.id })
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
