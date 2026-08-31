import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'

/**
 * Trial persistence. Lives in its own module (not db/agencies.ts) on purpose:
 * db/agencies.ts imports db/auth -> next/headers, which makes it un-importable
 * from tsx verification scripts. This module depends only on config/db and
 * the analytics emitter, so scripts/verify-trial-dev.ts exercises the REAL
 * production functions below — not copies of their SQL.
 */

/**
 * Trial fields for the layout gate. Deliberately NOT 'use cache' (unlike
 * getAgencyById): trial state gates access, and a stale cache after
 * startTrial() would re-show the welcome modal or hold an expired screen.
 */
export async function getAgencyTrial(agencyId: number) {
  // Model B: LEFT JOIN the subscription so getTrialState can decide PAID from an
  // ACTIVE prepaid period (planReason + expiresAt), not from agencies.plan alone.
  // subscriptions has a UNIQUE(agencyId), so the join yields at most one row;
  // a missing subscription leaves expiresAt null (fine — admin grants ignore it).
  return await db('agencies')
    .leftJoin('subscriptions', 'subscriptions.agencyId', 'agencies.id')
    .where('agencies.id', agencyId)
    .select(
      'agencies.plan',
      'agencies.trialExempt',
      'agencies.trialStartedAt',
      'agencies.trialEndsAt',
      'agencies.planReason',
      'subscriptions.expiresAt',
    )
    .first()
}

/**
 * The only writing transition in the trial state machine. Raw SQL so both
 * timestamps come from the same Postgres now(); the WHERE guard makes it
 * idempotent (concurrent clicks resolve to one winner and silent no-ops) and
 * makes activation impossible for exempt (legacy) and pro (paid) agencies —
 * both guards are load-bearing, not defensive decoration.
 */
export async function startTrialForAgency(
  agencyId: number,
  userId?: number | null,
): Promise<{ started: boolean }> {
  const res = await db.raw(
    `UPDATE agencies
     SET "trialStartedAt" = now(), "trialEndsAt" = now() + interval '7 days'
     WHERE id = ?
       AND "trialExempt" = false
       AND plan <> 'pro'
       AND "trialStartedAt" IS NULL`,
    [agencyId],
  )
  const started = res.rowCount === 1

  if (started) {
    await track({ agencyId, userId, event: 'trial_started' })
  }
  return { started }
}

/**
 * Funnel events for the welcome modal mount: desktop_first_access then
 * welcome_modal_shown — the same moment under click-to-start, kept as two
 * events so the funnel stays uniform if detection and display ever diverge.
 * Each is independently deduped once-per-agency by the DB index. Exempt
 * (legacy) and pro agencies are outside the funnel entirely.
 *
 * `desktop_first_access` IS MISNAMED and is deliberately NOT renamed here.
 * It fires whenever the welcome modal is seen, on any device — every phone
 * signup in production carries one, so any dashboard splitting device on the
 * event NAME is wrong. Renaming it would break `scripts/verify-trial-dev.ts`,
 * which asserts the exact event sequence, and silently break any external
 * consumer reading the old name.
 *
 * The fix applied instead is ADDITIVE: `surface` is recorded as a prop. Every
 * existing consumer keeps working unchanged, and the event becomes correctly
 * splittable from this deploy forward. The rename remains a documented
 * follow-up, not a silent breaking change.
 */
export async function recordWelcomeModalSeen(
  agencyId: number,
  userId?: number | null,
  surface: 'mobile' | 'desktop' = 'desktop',
): Promise<void> {
  const row = await getAgencyTrial(agencyId)
  if (!row || row.trialExempt || row.plan === 'pro') return
  await track({ agencyId, userId, event: 'desktop_first_access', props: { surface } })
  await track({ agencyId, userId, event: 'welcome_modal_shown', props: { surface } })
}

/**
 * Cross-tenant read for the platform-owner /admin dashboard. Returns the raw
 * trial fields per agency plus a connected-user count and the agency's admin
 * contact — status/daysRemaining are NOT computed here on purpose: the page
 * derives them with getTrialState() (the same pure function the live gate
 * uses), so the dashboard can never drift from what users actually experience.
 *
 * Read-only. Two flat selects aggregated in memory (no per-agency N+1, no
 * fragile GROUP BY over a text column). Owner-gated at the route.
 */
export type AdminAgencyTrial = {
  agencyId: number
  agencyName: string | null
  plan: 'free' | 'pro'
  trialExempt: boolean
  trialStartedAt: Date | string | null
  trialEndsAt: Date | string | null
  userCount: number
  adminName: string | null
  adminEmail: string | null
}

export async function listAgencyTrialsForAdmin(): Promise<AdminAgencyTrial[]> {
  const [agencies, users] = await Promise.all([
    db('agencies').select('id', 'name', 'plan', 'trialExempt', 'trialStartedAt', 'trialEndsAt'),
    db('users').select('agencyId', 'name', 'email', 'role'),
  ])

  const byAgency = new Map<number, { count: number; admin?: { name: string; email: string } }>()
  for (const u of users) {
    if (u.agencyId == null) continue
    const entry = byAgency.get(u.agencyId) ?? { count: 0 }
    entry.count += 1
    // First ADMIN/GM encountered is treated as the workspace contact.
    if (!entry.admin && (u.role === 'ADMIN' || u.role === 'GM')) {
      entry.admin = { name: u.name, email: u.email }
    }
    byAgency.set(u.agencyId, entry)
  }

  return agencies.map((a) => {
    const agg = byAgency.get(a.id)
    return {
      agencyId: a.id,
      agencyName: a.name ?? null,
      plan: a.plan,
      trialExempt: a.trialExempt,
      trialStartedAt: a.trialStartedAt,
      trialEndsAt: a.trialEndsAt,
      userCount: agg?.count ?? 0,
      adminName: agg?.admin?.name ?? null,
      adminEmail: agg?.admin?.email ?? null,
    }
  })
}

/**
 * Invited-but-not-yet-registered people for the /admin dashboard. They live in
 * `invitations` (not `users`) until they complete Google sign-up, so the agency
 * reader above never sees them. There is no `status` column: acceptance DELETES
 * the invitation row (api/invitation), so every row here is outstanding by
 * definition — expiry is derived from expiresAt. Read-only, owner-gated.
 */
export type AdminPendingInvite = {
  id: number
  email: string
  name: string
  role: string
  agencyId: number
  agencyName: string | null
  expiresAt: Date | string | null
  createdAt: Date | string | null
}

export async function listPendingInvitesForAdmin(): Promise<AdminPendingInvite[]> {
  const rows = await db('invitations as i')
    .leftJoin('agencies as a', 'a.id', 'i.agencyId')
    .select(
      'i.id',
      'i.email',
      'i.firstName',
      'i.lastName',
      'i.role',
      'i.agencyId',
      'i.expiresAt',
      'i.createdAt',
      'a.name as agencyName',
    )
    .orderBy('i.createdAt', 'desc')

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email,
    role: r.role,
    agencyId: r.agencyId,
    agencyName: r.agencyName ?? null,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }))
}
