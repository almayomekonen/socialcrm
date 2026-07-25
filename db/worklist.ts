import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getAgencyId } from './agencies'
import { isAdmin, type Roles } from '@/types/roles'
import { getEffectiveLeadPlan } from '@/lib/quota'

export type DueWorklistRow = {
  id: number
  name: string
  phone: string | null
  status: string | null
  leadSource: string | null
  nextFollowUpAt: string | Date | null
  followUpNote: string | null
  statusChangedAt: string | Date | null
  lastOutcomeType: string | null
  lastActivityAt: string | Date | null
}

type Scope = { agencyId: number; user: { role: Roles }; gotPermIds: number[]; plan: string }

export function applyDueMembership(q: Knex.QueryBuilder): void {
  q.whereRaw(`clients.status IS DISTINCT FROM 'closed' AND clients.status IS DISTINCT FROM 'lost'`).where((b) => {
    b.whereRaw(`clients."nextFollowUpAt" IS NOT NULL AND clients."nextFollowUpAt" <= NOW()`).orWhereRaw(
      `clients."nextFollowUpAt" IS NULL AND (
         (clients.status = 'new'        AND clients."statusChangedAt" <= NOW() - INTERVAL '2 hours')  OR
         (clients.status = 'contacted'  AND clients."statusChangedAt" <= NOW() - INTERVAL '24 hours') OR
         (clients.status = 'interested' AND clients."statusChangedAt" <= NOW() - INTERVAL '72 hours')
       )`,
    )
  })
}

function applyDueScope(q: Knex.QueryBuilder, { agencyId, user, gotPermIds, plan }: Scope): void {
  q.where('clients.agencyId', agencyId).where('lead', true)
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)
  applyDueMembership(q)
}

export async function getDueWorklist({
  user,
  gotPermIds,
  limit = 50,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  limit?: number
}): Promise<DueWorklistRow[]> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients').select(
    'id',
    'name',
    'phone',
    'status',
    'leadSource',
    'nextFollowUpAt',
    'followUpNote',
    'statusChangedAt',
    'lastOutcomeType',
    'lastActivityAt',
  )
  applyDueScope(q, { agencyId, user, gotPermIds, plan })

  q.orderByRaw(
    `CASE WHEN "nextFollowUpAt" IS NOT NULL THEN 0 ELSE 1 END, "nextFollowUpAt" ASC, "statusChangedAt" ASC, "id" ASC`,
  ).limit(limit)

  return q as unknown as Promise<DueWorklistRow[]>
}

export async function getDueWorklistCount({
  user,
  gotPermIds,
}: {
  user: { role: Roles }
  gotPermIds: number[]
}): Promise<number> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients')
  applyDueScope(q, { agencyId, user, gotPermIds, plan })
  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}

export type NewLeadRow = {
  id: number
  name: string
  phone: string | null
  status: string | null
  leadSource: string | null
  nextFollowUpAt: string | Date | null
  followUpNote: string | null
  createdAt: string | Date | null
}

export async function getNewLeads({
  user,
  gotPermIds,
  limit = 20,
}: {
  user: { role: Roles }
  gotPermIds: number[]
  limit?: number
}): Promise<NewLeadRow[]> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients')
    .where('agencyId', agencyId)
    .where('lead', true)
    .where('status', 'new')
    .select('id', 'name', 'phone', 'status', 'leadSource', 'nextFollowUpAt', 'followUpNote', 'createdAt')
    .orderBy('createdAt', 'desc')
    .limit(limit)
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  return q as unknown as Promise<NewLeadRow[]>
}

export async function getNewLeadsCount({ user, gotPermIds }: { user: { role: Roles }; gotPermIds: number[] }): Promise<number> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients').where('agencyId', agencyId).where('lead', true).where('status', 'new')
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}

export async function getDoneTodayCount({ user, gotPermIds }: { user: { role: Roles }; gotPermIds: number[] }): Promise<number> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)

  const q = db('clients').where('agencyId', agencyId).where('lead', true).whereRaw(`"lastActivityAt" >= date_trunc('day', NOW())`)
  if (gotPermIds && !isAdmin(user.role)) q.whereIn('userId', gotPermIds)
  if (plan === 'free') q.where('overQuota', false)

  const row = await q.count<Array<{ count?: string | number }>>('id as count').first()
  return Number(row?.count ?? 0)
}
