'use server'

import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import type { FacebookPage } from '@/lib/activation/activationState'
import { completeOnboarding as markOnboardingComplete } from '@/lib/activation/onboarding'

/**
 * Emit a KPI-driving activation event. Resolves the user server-side so the
 * client never handles agency/user ids. Best-effort: never throws into the UI.
 */
export async function trackActivation(event: AnalyticsEventName): Promise<void> {
  const user = await getUser()
  if (!user) return
  await track({ agencyId: user.agencyId, userId: user.id, event })
}

/**
 * The data-dependent facts for the activation flow, resolved OFF the render path.
 * Recovery: a missing/expired/invalid/wrong-user cookie yields an empty list —
 * the FSM maps that to a deterministic restart.
 */
export async function getActivationData(): Promise<{ alreadyConnected: boolean; pendingPages: FacebookPage[] }> {
  const user = await getUser()
  if (!user) return { alreadyConnected: false, pendingPages: [] }

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()

  let pendingPages: FacebookPage[] = []
  const cookie = (await cookies()).get('fb_pages')?.value
  if (cookie) {
    try {
      const payload = await decrypt(cookie)
      if (payload?.userId === user.id && Array.isArray(payload.pages)) {
        pendingPages = payload.pages as FacebookPage[]
      }
    } catch {
      // expired / tampered / invalid — leave empty
    }
  }

  return { alreadyConnected: !!connection, pendingPages }
}

/**
 * Mark onboarding complete for the current user's agency. Idempotent (the write
 * only transitions NULL → now() once). This releases the dashboard gate — and is
 * deliberately decoupled from which integration was used.
 */
export async function completeOnboarding(): Promise<void> {
  const user = await getUser()
  if (!user) return
  await markOnboardingComplete(user.agencyId)
}
