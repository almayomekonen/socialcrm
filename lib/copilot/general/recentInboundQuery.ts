import { db } from '@/config/db'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { TERMINAL_STATUSES } from '@/lib/today/constants'
import { isAdmin, type Roles } from '@/types/roles'
import type { Scope } from '@/db/briefing'

const PREVIEW = 8

export type RecentWhatsappInboundRow = {
  id: number
  name: string | null
  status: string | null
  lastInboundAt: string
}

function toIso(v: unknown): string {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString()
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    if (Number.isFinite(d.getTime())) return d.toISOString()
  }
  return ''
}

/**
 * Recent inbound WhatsApp: lastInboundAt set, not filtered by waiting-reply
 * or unread. Answered conversations still appear.
 */
export function recentWhatsappInboundQuery(opts: {
  agencyId: number
  user: { role: Roles }
  gotPermIds: number[]
  plan: string
}) {
  const q = db('inbox_conversations as cv')
    .join('clients as c', 'c.id', 'cv.leadId')
    .where('cv.agencyId', opts.agencyId)
    .andWhere('cv.channel', 'whatsapp')
    .andWhere('cv.state', 'open')
    .whereNotNull('cv.leadId')
    .whereNotNull('cv.lastInboundAt')
    .andWhere('c.lead', true)
    .whereNotIn('c.status', [...TERMINAL_STATUSES])

  if (opts.gotPermIds && !isAdmin(opts.user.role)) q.whereIn('c.userId', opts.gotPermIds)
  if (opts.plan === 'free') q.where('c.overQuota', false)

  return q.select('cv.id as conversationId', 'cv.leadId', 'c.name', 'c.status', 'cv.lastInboundAt')
}

export async function listRecentWhatsappInboundRows(
  user: { agencyId: number; role: Roles },
  scope: Scope,
): Promise<RecentWhatsappInboundRow[]> {
  try {
    const plan = await getEffectiveLeadPlan(user.agencyId)
    const rows = await recentWhatsappInboundQuery({
      agencyId: user.agencyId,
      user: { role: user.role },
      gotPermIds: scope.gotPermIds,
      plan,
    })
      .orderBy('cv.lastInboundAt', 'desc')
      .orderBy('cv.id', 'desc')
      .limit(PREVIEW)
    return (rows as { leadId: number; name: string | null; status: string | null; lastInboundAt: unknown }[]).map((r) => ({
      id: Number(r.leadId),
      name: r.name,
      status: r.status,
      lastInboundAt: toIso(r.lastInboundAt),
    }))
  } catch {
    return []
  }
}
