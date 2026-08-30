import { db } from '@/config/db'
import type { Knex } from 'knex'
import { getAgencyId } from './agencies'
import { isAdmin, type Roles } from '@/types/roles'
import { getEffectiveLeadPlan, type Plan } from '@/lib/quota'
import type { UpcomingFollowUp } from '@/lib/leads/upcomingFollowUps'

export async function getUpcomingFollowUps({
  user,
  gotPermIds,
  limit = 10,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  limit?: number
}): Promise<UpcomingFollowUp[]> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients')
    .where({ agencyId })
    .where('lead', true) // match the dashboard's lead universe — exclude converted deals (lead=false)
    .whereNotNull('nextFollowUpAt')
    .where('nextFollowUpAt', '>', db.fn.now())
    .whereNotIn('status', ['closed', 'lost'])
    .select('id', 'name', 'phone', 'status', 'nextFollowUpAt', 'followUpNote')
    .orderBy('nextFollowUpAt', 'asc')
    .orderBy('id', 'asc')
    .limit(limit + 1)

  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  return q as unknown as Promise<UpcomingFollowUp[]>
}

/** True count of upcoming (future, not-yet-due) follow-ups — for the Quick Links chip (uncapped). */
export async function getUpcomingFollowUpsCount({ user, gotPermIds }: { user: { role: Roles }; gotPermIds: number[] }): Promise<number> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients')
    .where({ agencyId })
    .where('lead', true)
    .whereNotNull('nextFollowUpAt')
    .where('nextFollowUpAt', '>', db.fn.now())
    .whereNotIn('status', ['closed', 'lost'])
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}

/**
 * ─── Mobile readers ──────────────────────────────────────────────────────────
 *
 * ⚠️ DELIBERATELY SEPARATE FROM THE TWO FUNCTIONS ABOVE, INCLUDING THE DUPLICATED
 * PREDICATE. Folding all four onto one shared helper is the tidier design, and it
 * was the first thing tried — but it rewrites code the web dashboard depends on
 * in order to add a feature the dashboard does not use. For the first production
 * push of a new subsystem that trade is the wrong way round: duplication is
 * visible and cheap, a silent scoping regression on the live dashboard is not.
 *
 * The predicate below is therefore a copy of the one in `getUpcomingFollowUps`,
 * with exactly one addition — the `overdue` bucket. If these ever need to
 * converge, that is a separate refactor with the dashboard's tests in scope.
 */

export type FollowUpBucket = 'overdue' | 'upcoming'

export type FollowUpRow = {
  id: number
  name: string | null
  phone: string | null
  status: string | null
  nextFollowUpAt: string | Date
  followUpNote: string | null
}

type FollowUpScope = {
  agencyId: number
  user: { role: Roles }
  gotPermIds: number[]
  plan: Plan
  bucket: FollowUpBucket
}

/**
 * Tenant scoping for the mobile readers — identical to the web predicate above:
 * agency, leads only (converted deals excluded), a real follow-up date, not
 * closed/lost, `gotPermIds` for non-admins, and the free-plan `overQuota`
 * withholding. The only difference is the bucket comparison.
 */
function applyFollowUpScope(q: Knex.QueryBuilder, scope: FollowUpScope): void {
  q.where({ agencyId: scope.agencyId })
    .where('lead', true) // match the dashboard's lead universe — exclude converted deals (lead=false)
    .whereNotNull('nextFollowUpAt')
    .whereNotIn('status', ['closed', 'lost'])

  // Boundary is the DATABASE clock, never the caller's. `NOW()` is evaluated by
  // Postgres, so an app server or a phone with a skewed clock cannot shift which
  // follow-ups count as due.
  if (scope.bucket === 'upcoming') q.where('nextFollowUpAt', '>', db.fn.now())
  else q.where('nextFollowUpAt', '<=', db.fn.now())

  if (scope.gotPermIds && !isAdmin(scope.user.role)) q.whereIn('userId', scope.gotPermIds)
  if (scope.plan === 'free') q.where('overQuota', false)
}

/**
 * `agencyId` is supplied by the caller for mobile, because `getAgencyId()`
 * resolves through `getUser()` → `cookies()`, which a bearer-authenticated
 * request does not have. It falls back to the session for any web caller.
 */
async function resolveScope(
  user: { role: Roles },
  gotPermIds: number[],
  bucket: FollowUpBucket,
  agencyIdOverride?: number,
): Promise<FollowUpScope> {
  const agencyId = agencyIdOverride ?? (await getAgencyId())
  return { agencyId, user, gotPermIds, plan: await getEffectiveLeadPlan(agencyId), bucket }
}

/**
 * One bucket of follow-ups, oldest date first.
 *
 * Ordering is `nextFollowUpAt ASC, id ASC` for BOTH buckets — deterministic, and
 * the same order the web reader uses. For overdue that puts the longest-waiting
 * lead first, which is the one the rep owes most.
 */
export async function listFollowUps({
  user,
  gotPermIds,
  bucket,
  limit = 50,
  agencyId: agencyIdOverride,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  bucket: FollowUpBucket
  limit?: number
  agencyId?: number
}): Promise<FollowUpRow[]> {
  const scope = await resolveScope(user, gotPermIds, bucket, agencyIdOverride)

  const q = db('clients')
    .select('id', 'name', 'phone', 'status', 'nextFollowUpAt', 'followUpNote')
    .orderBy('nextFollowUpAt', 'asc')
    .orderBy('id', 'asc')
    .limit(limit)
  applyFollowUpScope(q, scope)

  return q as unknown as Promise<FollowUpRow[]>
}

/** TRUE, uncapped count for a bucket — never derived from the capped list. */
export async function countFollowUps({
  user,
  gotPermIds,
  bucket,
  agencyId: agencyIdOverride,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  bucket: FollowUpBucket
  agencyId?: number
}): Promise<number> {
  const scope = await resolveScope(user, gotPermIds, bucket, agencyIdOverride)

  const q = db('clients')
  applyFollowUpScope(q, scope)

  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}
