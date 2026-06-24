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

  const since = new URL(req.url).searchParams.get('since')
  const { counts, items } = await getInboxAwareness(user.agencyId, user.id, since)
  return NextResponse.json({ counts, items, serverTime: new Date().toISOString() })
}
