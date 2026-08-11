import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { FEED_ITEM_LIMIT, FEED_MAX_LIMIT } from '@/db/notifications/feed'
import { buildNotificationFeed, inertFeed } from '@/lib/notifications/feed'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import type { FeedCursor } from '@/modules/notifications/types'

/**
 * The notification feed — unread counts, recent notifications, "While you were
 * away", and the presence stamp. Spec §13.1: this endpoint is the promotion of
 * /api/inbox/awareness, and the single adaptive poll loop is its only caller.
 *
 * A GET THAT WRITES, so caching it is not a performance regression but a
 * correctness and security failure — a cached response would stop presence
 * stamping AND could serve one user's notifications to another.
 *
 * NO `export const dynamic = 'force-dynamic'` HERE, AND THAT IS DELIBERATE.
 * `next.config.mjs` enables `cacheComponents`, under which Next 16.0.10 rejects
 * that segment config outright at build time:
 *
 *   Route segment config "dynamic" is not compatible with
 *   `nextConfig.cacheComponents`. Please remove it.
 *
 * (Verified by running the build, not assumed — which is also why no route in
 * this repo exports it.) Under Cache Components the default inverts: nothing is
 * cached unless it opts in with a `'use cache'` directive. So the feed is
 * uncached because no code on its path opts in, which is a stronger guarantee
 * than opting out would be — there is no cache to escape.
 *
 * Three defences remain, none of them a segment config:
 *   1. Nothing in this path uses `'use cache'`, `unstable_cache`, or `revalidate`.
 *   2. `Cache-Control: no-store` on EVERY response, including 401/403 — this is
 *      the only one that reaches the CDN and the browser.
 *   3. `getUser()` reads cookies, which independently forces dynamic rendering.
 */

/** Applied to EVERY exit, including the error paths. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * `<epochMs>_<id>`, echoed from a previous response's nextCursor.
 *
 * A cursor is not a capability: it names a position, and every query it feeds is
 * still scoped to the session's own agency and user. A cursor pointing at another
 * tenant's row simply returns that user's next page (spec §20.2 — ids never grant
 * access). Malformed input degrades to "first page" rather than erroring, because
 * a stale cursor from an old tab is a normal event, not a client bug.
 */
function parseCursor(raw: string | null): FeedCursor | null {
  if (!raw) return null
  const [ms, id] = raw.split('_')
  const at = Number(ms)
  const rowId = Number(id)
  if (!Number.isFinite(at) || !Number.isFinite(rowId) || rowId <= 0) return null
  return { createdAt: new Date(at).toISOString(), id: rowId }
}

function parseLimit(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return FEED_ITEM_LIMIT
  return Math.min(Math.trunc(n), FEED_MAX_LIMIT)
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403, headers: NO_STORE })
  }

  /**
   * The gate comes AFTER auth and BEFORE any notification table is touched, so a
   * disabled feature costs two flag reads and writes nothing — including no
   * presence row. Presence is gated on NOTIFICATIONS_ENABLED and deliberately
   * NOT on INBOX_DELTA_SYNC (spec §7.2): inheriting that unrelated flag would
   * classify a user actively working in the app as OFFLINE.
   */
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) {
    return NextResponse.json(inertFeed(), { headers: NO_STORE })
  }

  const params = new URL(req.url).searchParams

  /**
   * agencyId and userId come from the SESSION and are never read from the query
   * string. `visible` is the only client-supplied input that reaches a write, and
   * it can only ever describe the caller's own presence row.
   */
  const feed = await buildNotificationFeed({
    agencyId: user.agencyId,
    userId: user.id,
    role: user.role,
    visible: params.get('visible') !== '0',
    limit: parseLimit(params.get('limit')),
    cursor: parseCursor(params.get('cursor')),
  })

  return NextResponse.json({ enabled: true, ...feed }, { headers: NO_STORE })
}
