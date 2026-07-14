import { db } from '@/config/db'
import { isAgencyAllowlisted } from '@/lib/ai/flags'
import { isDevBypassAgency } from '@/lib/auth/devBypass'
import type { Plan, PlanSource } from './types'

type AgencyPlanRow = { plan: string | null; planReason: string | null }

export async function readAgencyPlanRow(agencyId: number): Promise<AgencyPlanRow | null> {
  const row = await db('agencies').where({ id: agencyId }).select('plan', 'planReason').first<AgencyPlanRow>()
  return row ?? null
}

export function derivePlanSource(plan: Plan, planReason: string | null, allowlisted: boolean): PlanSource {
  if (plan === 'pro') {
    if (planReason && planReason.startsWith('grow:')) return 'payment'
    return 'admin-grant'
  }
  if (allowlisted) return 'allowlist'
  return null
}

export async function resolvePlanAndSource(agencyId: number): Promise<{ plan: Plan; planSource: PlanSource }> {
  const row = await readAgencyPlanRow(agencyId)
  const bypass = await isDevBypassAgency(agencyId)
  const plan: Plan = bypass || row?.plan === 'pro' ? 'pro' : 'free'
  const allowlisted = isAgencyAllowlisted(agencyId)
  const planSource = derivePlanSource(plan, row?.planReason ?? null, allowlisted)
  return { plan, planSource }
}
