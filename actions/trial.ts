'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { startTrialForAgency, recordWelcomeModalSeen } from '@/db/trial'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'

export type StartTrialResult = { ok: true; started: boolean } | { error: 'unauthorized' }

export async function startTrial(): Promise<StartTrialResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  const { started } = await startTrialForAgency(user.agencyId, user.id)

  // Fire the immediate "Pro trial started" confirmation ONLY on the real
  // NEVER_STARTED → TRIAL_ACTIVE transition. `started` is true exactly once
  // (DB WHERE guard + rowCount === 1), so refresh, modal re-view, double-click
  // and concurrent calls all resolve to started=false and send nothing; PAID /
  // LEGACY / already-started / expired never satisfy the guard. The send runs
  // in after() (post-response) and dispatchLifecycleEvent never throws, so email
  // delivery can neither delay nor roll back trial activation. Recipient is the
  // authenticated activator; the automation's dedup key ('trial_started') is the
  // belt-and-suspenders second guarantee of exactly-once delivery.
  if (started) {
    const recipient = {
      userId: user.id,
      agencyId: user.agencyId,
      email: user.email,
      firstName: user.name?.trim().split(/\s+/)[0] || null,
    }
    after(() => dispatchLifecycleEvent('trial.started', recipient, new Date()))
  }

  revalidatePath('/', 'layout')
  return { ok: true, started }
}

export type TrackSeenResult = { ok: true } | { error: 'unauthorized' }

export async function trackWelcomeModalSeen(): Promise<TrackSeenResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  await recordWelcomeModalSeen(user.agencyId, user.id)
  return { ok: true }
}
