'use server'

import { requireUser } from '@/lib/requireUser'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { revalidatePath } from 'next/cache'
import { getQuotaStatus } from '@/lib/quota'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import type { QuotaStatus } from '@/lib/quota'

export async function getAgencyQuotaStatus(): Promise<QuotaStatus> {
  const user = await requireUser()
  return getQuotaStatus(user.agencyId)
}

export type UpgradeAgencyResult = { success: true } | { error: 'forbidden' | 'not_found' | 'invalid_input' }

/**
 * Grant Pro to an agency WITHOUT payment: a CROSS-TENANT operation.
 *
 * Platform owners only (`isPlatformOwner`, the /admin gate). An agency
 * ADMIN/GM is workspace-scoped and must never reach this: before, any agency
 * admin could pass an arbitrary `agencyId` and grant (or extend) Pro for any
 * agency, including their own, for free.
 *
 * `reason` becomes `agencies.planReason`. The `grow:` prefix is reserved for
 * verified payments (lib/trial `isPaidPeriodActive`, lib/quota/subscription),
 * so a manual grant can never impersonate a paid period. Every grant is
 * audited (`admin_plan_grant`).
 */
export async function upgradeAgencyToPro(agencyId: number, reason: string = 'manual'): Promise<UpgradeAgencyResult> {
  const user = await requireUser()
  if (!isPlatformOwner(user.email)) return { error: 'forbidden' }
  if (!Number.isSafeInteger(agencyId) || agencyId <= 0) return { error: 'invalid_input' }
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (!why || why.length > 64 || why.toLowerCase().startsWith('grow:')) return { error: 'invalid_input' }

  const result = await performAgencyUpgrade(agencyId, why)
  if ('error' in result) return result

  await track({ agencyId, userId: user.id, event: 'admin_plan_grant', props: { reason: why, actorAgencyId: user.agencyId } })
  revalidatePath('/leads')
  return { success: true }
}
