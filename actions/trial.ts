'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { track } from '@/lib/analytics/track'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { startTrialForAgency, recordWelcomeModalSeen } from '@/db/trial'
import { isMobileRequest } from '@/lib/device'
import { isCardRequiredTrialEnabledForAgency } from '@/lib/payments/grow/config'

export type StartTrialResult = { ok: true; started: boolean } | { error: 'unauthorized' | 'card_required' }

export async function startTrial(): Promise<StartTrialResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  // Card-required trials start ONLY from the verified Grow callback. The DB
  // write point enforces this too; refusing here keeps a stale client honest.
  if (isCardRequiredTrialEnabledForAgency(user.agencyId)) return { error: 'card_required' }

  const { started } = await startTrialForAgency(user.agencyId, user.id)

  // Fire the immediate "Pro trial started" confirmation ONLY on the real
  // NEVER_STARTED → TRIAL_ACTIVE transition. `started` is true exactly once
  // (DB WHERE guard + rowCount === 1), so refresh, modal re-view, double-click
  // and concurrent calls all resolve to started=false and send nothing; PAID /
  // LEGACY / already-started / expired never satisfy the guard. The send runs
  // in after() (post-response) and the mailer is imported THERE, not at module
  // load: config/resend.ts builds its client on import and throws when RESEND is
  // unset, which would otherwise make a missing email key break trial
  // activation itself. Email can neither delay nor roll back activation. Recipient is the
  // authenticated activator; the automation's dedup key ('trial_started') is the
  // belt-and-suspenders second guarantee of exactly-once delivery.
  if (started) {
    const recipient = {
      userId: user.id,
      agencyId: user.agencyId,
      email: user.email,
      firstName: user.name?.trim().split(/\s+/)[0] || null,
    }
    after(async () => {
      try {
        const { dispatchLifecycleEvent } = await import('@/lib/emailAutomations/live')
        await dispatchLifecycleEvent('trial.started', recipient, new Date())
      } catch (err) {
        console.error('[trial] trial.started not dispatched', { agencyId: user.agencyId, err: String(err) })
      }
    })
  }

  revalidatePath('/', 'layout')
  return { ok: true, started }
}

export type TrackSeenResult = { ok: true } | { error: 'unauthorized' }

/**
 * Allowlisted failure categories. A category, never a message: the raw error
 * could carry account or network detail, and this lands in analytics_events
 * permanently.
 */
export type TrialStartFailure = 'unauthorized' | 'network' | 'unknown'
const TRIAL_START_FAILURES = new Set<TrialStartFailure>(['unauthorized', 'network', 'unknown'])

/**
 * The CTA was pressed. Paired with `trial_started`, a click with no start is the
 * signal that separates "walked away" from "tried and it failed".
 *
 * Fire-and-forget: telemetry must never block or break the only way out of a
 * non-dismissible modal.
 */
export async function trackTrialStartClicked(): Promise<void> {
  try {
    const user = await requireAgencyUser()
    await track({ agencyId: user.agencyId, userId: user.id, event: 'trial_start_clicked', props: { cardRequired: isCardRequiredTrialEnabledForAgency(user.agencyId) } })
  } catch {
    // Swallowed on purpose — see above.
  }
}

/** The start failed, with a safe category. Same fire-and-forget contract. */
export async function trackTrialStartFailed(reason: TrialStartFailure): Promise<void> {
  if (!TRIAL_START_FAILURES.has(reason)) return
  try {
    const user = await requireAgencyUser()
    await track({ agencyId: user.agencyId, userId: user.id, event: 'trial_start_failed', props: { reason } })
  } catch {
    // An `unauthorized` failure cannot resolve a user, so that one case records
    // nothing. The click event still fired, which is what separates it from
    // abandonment.
  }
}

export async function trackWelcomeModalSeen(): Promise<TrackSeenResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  // Resolved server-side from the User-Agent, the same single source of truth
  // the (app) layout gate uses — never a client-supplied value, which would let
  // the one device signal in this funnel be spoofed by the surface it measures.
  const surface = (await isMobileRequest()) ? 'mobile' : 'desktop'
  await recordWelcomeModalSeen(user.agencyId, user.id, surface)
  return { ok: true }
}
