import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { sendWeddingInvite } from '@/lib/weddingRsvp/invite'

/**
 * TEMPORARY — Wedding RSVP (see lib/weddingRsvp/config.ts). Sends the approved
 * `wedding_invite` template to exactly ONE phone number of the signed-in user's
 * agency, creating the Lead/conversation if the number is new. The number must
 * be on the hard allowlist; there is no list or bulk input.
 *
 *   POST /api/wedding-rsvp/invite   { "phone": "0535353219", "firstName": "אברהם", "lastName": "בוגלה" }
 */
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { phone?: unknown; firstName?: unknown; lastName?: unknown }
  if (typeof body.phone !== 'string' || typeof body.firstName !== 'string') {
    return NextResponse.json({ error: 'invalid-input' }, { status: 400 })
  }

  const result = await sendWeddingInvite({
    agencyId: user.agencyId,
    userId: user.id,
    phone: body.phone,
    firstName: body.firstName,
    lastName: typeof body.lastName === 'string' ? body.lastName : '',
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
