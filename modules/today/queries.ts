import { getPerms } from '@/db/filter'
import { hasAnyLeads } from '@/db/clients'
import { getDueWorklist, getDueWorklistCount, getNewLeads, getNewLeadsCount, getDoneTodayCount } from '@/db/worklist'
import type { DueWorklistRow } from '@/db/worklist'
import { getTodaysMeetings } from '@/db/meetings'
import { getUpcomingFollowUpsCount } from '@/db/followUps'
import { pickTopRecommended, recommendReason, type Recommendation } from '@/lib/leads/recommend'
import type { Roles } from '@/types/roles'

/**
 * Today's data, resolved once for BOTH presentations.
 *
 * Extracted VERBATIM from `components/home/DashboardPage.tsx` so the desktop
 * dashboard and the mobile Today can never disagree about what is due, what is
 * recommended, or how many items remain. The desktop page now calls this
 * instead of holding its own copy — the numbers it renders are unchanged,
 * because this is the same sequence of calls in the same order.
 *
 * Holds NO business rules. Ordering lives in `db/worklist`, recommendation in
 * `lib/leads/recommend`, permissions in `db/filter`. This module only sequences
 * them. Follows the `modules/inbox` shape (queries.ts is presentation-free).
 *
 * SCOPE/TENANCY: every read is scoped by `getPerms(user)` → `gotPermIds` and by
 * `user.agencyId`, exactly as before. Mobile does not widen visibility by a
 * single row: it calls this with the same arguments the desktop page does.
 */

export type TodaySnapshot = {
  hasLeads: boolean
  due: DueWorklistRow[]
  dueCount: number
  newLeadsCount: number
  upcomingCount: number
  doneToday: number
  meetings: Awaited<ReturnType<typeof getTodaysMeetings>>
  recommended: Recommendation[]
  /** Due rows minus the ones promoted into `recommended` (no lead appears twice). */
  tableRows: DueWorklistRow[]
  tableTotal: number
  progressPct: number
}

/**
 * Exactly the viewer fields the reads below need — never the whole session user.
 * `agencyId` is optional to match `UserDb` verbatim: the desktop page has always
 * passed it straight through, so widening it here would change which calls
 * typecheck and silently alter behaviour this extraction must preserve.
 */
export type TodayViewer = { id: number; agencyId?: number; role: Roles }

/**
 * Step 1: permissions + "does this workspace have any leads at all".
 *
 * Kept SEPARATE from the snapshot on purpose. The desktop page checks these
 * two things, may redirect, and may serve the v2 brief — all before the heavy
 * worklist queries run. Folding them into one call would make every v2-brief
 * request pay for a worklist it never renders, which is a real behaviour
 * change disguised as a refactor.
 */
export async function resolveTodayScope(user: TodayViewer): Promise<{ gotPermIds: number[]; hasLeads: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { gotPermIds } = await getPerms(user as any)
  const hasLeads = await hasAnyLeads(user.agencyId, gotPermIds, user.role)
  return { gotPermIds, hasLeads }
}

/** Step 2: the worklist itself. Takes the already-resolved permission scope. */
export async function resolveTodaySnapshot(
  user: TodayViewer,
  gotPermIds: number[],
  nowMs: number,
  recommendCount = 3,
): Promise<Omit<TodaySnapshot, 'hasLeads'>> {
  const [due, dueCount, newLeads, meetings, doneToday, newLeadsCount, upcomingCount] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDueWorklist({ user: user as any, gotPermIds, limit: 100 }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDueWorklistCount({ user: user as any, gotPermIds }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNewLeads({ user: user as any, gotPermIds }),
    getTodaysMeetings({ agencyId: user.agencyId, organizerUserId: user.id }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDoneTodayCount({ user: user as any, gotPermIds }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNewLeadsCount({ user: user as any, gotPermIds }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getUpcomingFollowUpsCount({ user: user as any, gotPermIds }),
  ])

  const recommended = pickTopRecommended(due, newLeads, recommendCount, nowMs)

  const recommendedIds = new Set(recommended.map((r) => r.lead.id))
  const dueIds = new Set(due.map((d) => d.id))
  const tableRows = due.filter((r) => !recommendedIds.has(r.id))
  const removedFromDue = recommended.filter((r) => dueIds.has(r.lead.id)).length
  const tableTotal = dueCount - removedFromDue

  const progressTotal = doneToday + dueCount
  const progressPct = progressTotal > 0 ? Math.round((doneToday / progressTotal) * 100) : 100

  return {
    due,
    dueCount,
    newLeadsCount,
    upcomingCount,
    doneToday,
    meetings,
    recommended,
    tableRows,
    tableTotal,
    progressPct,
  }
}

/**
 * The reason string for a due row, computed SERVER-SIDE.
 *
 * Mobile must not repeat the client-side `startOfToday()` comparison that
 * `FollowupsTable` does: a business-day boundary derived in the browser and
 * again on the server is the exact hydration-mismatch class that
 * `architecture-rules.md` §11 exists to prevent (Vercel runs UTC, the rep's
 * phone runs Asia/Jerusalem). `recommendReason` is pure and takes an injected
 * clock, so calling it here keeps the decision on the server and ships the
 * label as data.
 */
export function reasonForDueRow(row: DueWorklistRow, nowMs: number): string {
  return recommendReason(row, nowMs)
}
