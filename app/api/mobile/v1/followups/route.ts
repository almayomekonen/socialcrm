import { NextResponse } from 'next/server'
import { countFollowUps, listFollowUps, type FollowUpRow } from '@/db/followUps'
import { MobileAuthError, requireMobileProductAccess } from '@/lib/mobile/auth'
import { fail, ok } from '@/lib/mobile/http'

/**
 * GET /api/mobile/v1/followups — the rep's follow-up list.
 *
 * A THIN ADAPTER over `db/followUps.ts`, which owns the whole scoping predicate:
 * agency, leads-only, a real `nextFollowUpAt`, not closed/lost, `gotPermIds` for
 * non-admins, and the free-plan `overQuota` withholding. None of that is
 * reimplemented here.
 *
 * TWO BUCKETS, BOTH SERVER-DEFINED. `overdue` is `nextFollowUpAt <= NOW()` and
 * `upcoming` is `> NOW()`, evaluated by POSTGRES — the device clock never
 * decides which bucket a follow-up is in.
 *
 * THERE IS DELIBERATELY NO "TODAY" BUCKET. The follow-up readers have no
 * business-day boundary; only the Today brief does, via its own
 * `businessDayBounds`. Splitting "today" out here would mean inventing a
 * day-boundary rule that the follow-up data model does not have, and it would
 * quietly disagree with the brief.
 *
 * NOT the due worklist. `db/worklist.ts` also matches leads with NO follow-up
 * date that have merely gone stale against their SLA. Everything here is a date
 * a human actually set.
 */

/** A phone list; the true totals are reported separately and uncapped. */
const MOBILE_FOLLOWUP_LIMIT = 50

/**
 * Allow-list projection.
 *
 * The rows are selected narrowly upstream, but this stays explicit so a widened
 * `select` upstream can never start shipping `agencyId`, `idNum` or `userId` to
 * a device.
 */
function toMobileFollowUp(row: FollowUpRow) {
  return {
    leadId: Number(row.id),
    name: row.name ?? '',
    phone: row.phone ?? null,
    status: row.status ?? null,
    // ISO, server-computed. The client formats but never re-derives the bucket.
    dueAt: new Date(row.nextFollowUpAt).toISOString(),
    note: row.followUpNote ?? null,
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  let user
  try {
    user = await requireMobileProductAccess(req)
  } catch (err) {
    if (err instanceof MobileAuthError) return fail(err.code, err.status)
    throw err
  }

  try {
    const scope = { user: { role: user.role as never }, gotPermIds: user.gotPermIds, agencyId: user.agencyId }

    const [overdue, upcoming, overdueTotal, upcomingTotal] = await Promise.all([
      listFollowUps({ ...scope, bucket: 'overdue', limit: MOBILE_FOLLOWUP_LIMIT }),
      listFollowUps({ ...scope, bucket: 'upcoming', limit: MOBILE_FOLLOWUP_LIMIT }),
      countFollowUps({ ...scope, bucket: 'overdue' }),
      countFollowUps({ ...scope, bucket: 'upcoming' }),
    ])

    return ok({
      overdue: overdue.map(toMobileFollowUp),
      upcoming: upcoming.map(toMobileFollowUp),
      /**
       * REAL counts from their own uncapped queries — never `items.length`,
       * which would silently under-report once a bucket exceeds the limit.
       */
      overdueTotal,
      upcomingTotal,
    })
  } catch (err) {
    /**
     * NOT an empty list. `200 { overdue: [], upcoming: [] }` would tell a rep
     * with overdue follow-ups that they are all caught up.
     */
    console.error('[mobile/followups] failed', { userId: user.id, reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
