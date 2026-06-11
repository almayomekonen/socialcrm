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
  return await db('agencies')
    .where({ id: agencyId })
    .select('plan', 'trialExempt', 'trialStartedAt', 'trialEndsAt')
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
 */
export async function recordWelcomeModalSeen(agencyId: number, userId?: number | null): Promise<void> {
  const row = await getAgencyTrial(agencyId)
  if (!row || row.trialExempt || row.plan === 'pro') return
  await track({ agencyId, userId, event: 'desktop_first_access' })
  await track({ agencyId, userId, event: 'welcome_modal_shown' })
}
