import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { lastHumanOutboundSubquery, waitingReplySql } from '@/lib/inbox/waitingReplySql'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { TERMINAL_STATUSES } from '@/lib/today/constants'
import { isAdmin, type Roles } from '@/types/roles'

export type WaitingWhatsappRow = {
  conversationId: number
  leadId: number
  name: string | null
  phone: string | null
  status: string | null
  lastInboundAt: Date | string
  lastHumanOutboundAt: Date | string | null
}

export function oldestWaitingWhatsappQuery(opts: {
  agencyId: number
  user: { role: Roles }
  gotPermIds: number[]
  plan: string
  leadIds?: number[]
}) {
  const q = db('inbox_conversations as cv')
    .join('clients as c', 'c.id', 'cv.leadId')
    .where('cv.agencyId', opts.agencyId)
    .andWhere('cv.channel', 'whatsapp')
    .andWhere('cv.state', 'open')
    .whereNotNull('cv.leadId')
    .andWhere('c.lead', true)
    .whereNotIn('c.status', [...TERMINAL_STATUSES])
    .whereRaw(waitingReplySql('cv'))

  if (opts.gotPermIds && !isAdmin(opts.user.role)) q.whereIn('c.userId', opts.gotPermIds)
  if (opts.plan === 'free') q.where('c.overQuota', false)
  if (opts.leadIds && opts.leadIds.length > 0) q.whereIn('cv.leadId', opts.leadIds)

  return q.select(
    'cv.id as conversationId',
    'cv.leadId',
    'c.name',
    'c.phone',
    'c.status',
    'cv.lastInboundAt',
    db.raw(`${lastHumanOutboundSubquery('cv.id')} as "lastHumanOutboundAt"`),
  )
}

export async function findOldestWaitingWhatsappConversation(opts: {
  user: { role: Roles }
  gotPermIds: number[]
}): Promise<WaitingWhatsappRow | null> {
  const agencyId = await getAgencyId()
  const plan = await getEffectiveLeadPlan(agencyId)
  const row = await oldestWaitingWhatsappQuery({
    agencyId,
    user: opts.user,
    gotPermIds: opts.gotPermIds,
    plan,
  })
    .orderBy('cv.lastInboundAt', 'asc')
    .orderBy('cv.id', 'asc')
    .first()

  return row ? toWaitingRow(row as Record<string, unknown>) : null
}

export async function listOldestWaitingWhatsappByLeadIds(opts: {
  agencyId: number
  user: { role: Roles }
  gotPermIds: number[]
  leadIds: number[]
}): Promise<WaitingWhatsappRow[]> {
  if (opts.leadIds.length === 0) return []
  const plan = await getEffectiveLeadPlan(opts.agencyId)
  const rows = await oldestWaitingWhatsappQuery({
    agencyId: opts.agencyId,
    user: opts.user,
    gotPermIds: opts.gotPermIds,
    plan,
    leadIds: opts.leadIds,
  })
    .distinctOn('cv.leadId')
    .orderBy('cv.leadId', 'asc')
    .orderBy('cv.lastInboundAt', 'asc')
    .orderBy('cv.id', 'asc')

  return (rows as Record<string, unknown>[]).map(toWaitingRow)
}

function toWaitingRow(r: Record<string, unknown>): WaitingWhatsappRow {
  return {
    conversationId: Number(r.conversationId),
    leadId: Number(r.leadId),
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    lastInboundAt: r.lastInboundAt as Date | string,
    lastHumanOutboundAt: (r.lastHumanOutboundAt as Date | string | null) ?? null,
  }
}
