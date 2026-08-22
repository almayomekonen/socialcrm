import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getInboxAwareness } from '@/modules/inbox/queries'

/**
 * Global awareness feed (used by the app-shell loop OUTSIDE /inbox): the per-user
 * unread count + recent unread arrivals (toast / future bell). Per-user, never cached.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  /*
   * TIER 1 READ. This endpoint only reads the agency's own stored rows and
   * stamps presence; it consumes no paid or external resource. Viewing what is
   * already there is exactly what an expired customer keeps, so the
   * product-access gate that used to sit here has been removed.
   *
   * Authentication and tenant isolation are untouched: the 401 above still
   * runs first, and every query below is scoped by the session's agencyId. The
   * Pro gates live where money is spent, at the actions this data links to.
   */

  const since = new URL(req.url).searchParams.get('since')
  const { counts, items } = await getInboxAwareness(user.agencyId, user.id, since)
  return NextResponse.json({ counts, items, serverTime: new Date().toISOString() })
}
