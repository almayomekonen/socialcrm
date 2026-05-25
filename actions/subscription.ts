'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'

export type CancelResumeResult = { ok: true } | { error: 'unauthorized' | 'no_subscription' }

async function setCancelFlag(value: boolean): Promise<CancelResumeResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  const rowcount = await db('subscriptions')
    .where({ agencyId: user.agencyId })
    .update({ cancelAtPeriodEnd: value, updatedAt: new Date() })

  if (rowcount === 0) return { error: 'no_subscription' }

  revalidatePath('/settings/update_payment')
  return { ok: true }
}

export async function cancelRenewal(): Promise<CancelResumeResult> {
  return setCancelFlag(true)
}

export async function resumeRenewal(): Promise<CancelResumeResult> {
  return setCancelFlag(false)
}
