'use server'

import { requireUser } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { revalidatePath } from 'next/cache'
import { getQuotaStatus } from '@/lib/quota'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import type { QuotaStatus } from '@/lib/quota'

export async function getAgencyQuotaStatus(): Promise<QuotaStatus> {
  const user = await requireUser()
  return getQuotaStatus(user.agencyId)
}

export type UpgradeAgencyResult = { success: true } | { error: 'forbidden' | 'not_found' }

export async function upgradeAgencyToPro(agencyId: number, reason: string = 'manual'): Promise<UpgradeAgencyResult> {
  const user = await requireUser()
  if (!isAdmin(user.role)) return { error: 'forbidden' }

  const result = await performAgencyUpgrade(agencyId, reason)
  if ('error' in result) return result

  revalidatePath('/leads')
  return { success: true }
}
