import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isDevBypassAgency } from '@/lib/auth/devBypass'
import { FREE_LEAD_LIMIT } from './constants'
import { Plan, QuotaExceededError, QuotaStatus } from './types'

export { FREE_LEAD_LIMIT } from './constants'
export { QuotaExceededError } from './types'
export type { Plan, QuotaStatus, QuotaErrorResult } from './types'
export { withAgencyQuotaLock, QUOTA_LOCK_NAMESPACE } from './withAgencyQuotaLock'

export async function getAgencyPlan(agencyId: number, q: Knex = db): Promise<Plan> {
  if (await isDevBypassAgency(agencyId)) return 'pro'
  const row = await q('agencies').where({ id: agencyId }).select('plan').first()
  return row?.plan === 'pro' ? 'pro' : 'free'
}

async function countVisibleLeads(agencyId: number, q: Knex = db): Promise<number> {
  const row = await q('clients').where({ agencyId, overQuota: false, lead: true }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

export async function assertLeadQuota(agencyId: number, incoming = 1, q: Knex = db): Promise<void> {
  const plan = await getAgencyPlan(agencyId, q)
  if (plan === 'pro') return

  const current = await countVisibleLeads(agencyId, q)
  if (current + incoming > FREE_LEAD_LIMIT) {
    throw new QuotaExceededError(current, FREE_LEAD_LIMIT, incoming)
  }
}

export async function getQuotaStatus(agencyId: number): Promise<QuotaStatus> {
  const [plan, visibleRow, overRow] = await Promise.all([
    getAgencyPlan(agencyId),
    db('clients').where({ agencyId, overQuota: false, lead: true }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, overQuota: true, lead: true }).count<{ count: string }>('id as count').first(),
  ])

  const used = Number(visibleRow?.count ?? 0)
  const overQuotaCount = Number(overRow?.count ?? 0)

  if (plan === 'pro') {
    return { plan, used, limit: null, remaining: null, overQuotaCount: 0 }
  }

  return {
    plan,
    used,
    limit: FREE_LEAD_LIMIT,
    remaining: Math.max(0, FREE_LEAD_LIMIT - used),
    overQuotaCount,
  }
}
