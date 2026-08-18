import { oldestWaitingWhatsappQuery } from '@/db/inboxWaiting'
import type { BriefingLeadList, Scope } from '@/db/briefing'
import { getEffectiveLeadPlan } from '@/lib/quota'
import type { Roles } from '@/types/roles'

const PREVIEW = 8

export type WaitingWhatsappLead = {
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

/** Existing waiting-reply reader. Fail closed. */
export async function listWaitingWhatsappRows(
  user: { agencyId: number; role: Roles },
  scope: Scope,
  order: 'asc' | 'desc',
): Promise<WaitingWhatsappLead[]> {
  try {
    const plan = await getEffectiveLeadPlan(user.agencyId)
    const rows = await oldestWaitingWhatsappQuery({
      agencyId: user.agencyId,
      user: { role: user.role },
      gotPermIds: scope.gotPermIds,
      plan,
    })
      .orderBy('cv.lastInboundAt', order)
      .orderBy('cv.id', order)
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

export async function listWaitingWhatsappLeads(
  user: { agencyId: number; role: Roles },
  scope: Scope,
): Promise<BriefingLeadList> {
  const rows = await listWaitingWhatsappRows(user, scope, 'asc')
  return {
    total: rows.length,
    sample: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })),
  }
}
