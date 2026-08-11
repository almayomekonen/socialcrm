import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { markAllNotificationsRead, markNotificationsRead, parseIds } from '@/db/notifications/reads'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'

/**
 * Mark notifications read — the user's explicit action. Spec §8.1.
 *
 * Body is either `{ ids: number[] }` or `{ all: true }`. readAt clears the badge
 * and FREES THE COLLAPSE KEY, so this is the endpoint that lets a genuinely new
 * event for the same entity open a fresh row instead of being absorbed.
 *
 * It deliberately does not touch seenAt (see db/notifications/reads.ts) and it has
 * no notion of resolvedAt: reading a notification about an unhandled lead does not
 * handle the lead.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403, headers: NO_STORE })
  }
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) {
    return NextResponse.json({ error: 'notifications-disabled' }, { status: 404, headers: NO_STORE })
  }

  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null
  const scope = { agencyId: user.agencyId, userId: user.id }

  if (body?.all === true) {
    const updated = await markAllNotificationsRead(scope)
    return NextResponse.json({ ok: true, updated }, { headers: NO_STORE })
  }

  const ids = parseIds(body?.ids)
  if (!ids) return NextResponse.json({ error: 'invalid-ids' }, { status: 400, headers: NO_STORE })

  const updated = await markNotificationsRead({ ...scope, ids })
  return NextResponse.json({ ok: true, updated }, { headers: NO_STORE })
}
