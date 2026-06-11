'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { startTrialForAgency, recordWelcomeModalSeen } from '@/db/trial'

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
