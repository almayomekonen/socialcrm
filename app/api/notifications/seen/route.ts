import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { markNotificationsSeen, parseIds } from '@/db/notifications/reads'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'

/**
 * Stamp seenAt on rows a SocialCRM surface actually presented. Spec §8.2.
 *
 * THE CALLER MUST HAVE SURFACED THEM. This endpoint exists precisely so that
 * "the feed returned a row" and "the user saw a row" stay different events: the
 * feed GET never stamps, and the client posts here only for rows it genuinely
 * rendered — in P2.2 that means toasted, and from P2.3 also dropdown-rendered.
 *
 * A web push must NEVER reach this endpoint. The OS displaying a notification is
 * not SocialCRM surfacing it, and treating it as such would silently empty
 * "While you were away" for the users who most need it (spec §13.3).
 *
 * Not cached: it is a POST, and it carries no-store anyway so no intermediary
 * can replay it.
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

  const body = await req.json().catch(() => null)
  const ids = parseIds((body as { ids?: unknown } | null)?.ids)
  if (!ids) return NextResponse.json({ error: 'invalid-ids' }, { status: 400, headers: NO_STORE })

  /**
   * agencyId and userId come from the SESSION. The body carries ids only — there
   * is no field a client could set to address another user's rows, which is why
   * an id is safe to accept here at all (spec §20.1).
   */
  const updated = await markNotificationsSeen({ agencyId: user.agencyId, userId: user.id, ids })

  return NextResponse.json({ ok: true, updated }, { headers: NO_STORE })
}
