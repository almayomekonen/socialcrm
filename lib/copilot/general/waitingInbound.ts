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

type WaitingActor = { agencyId: number; role: Roles }

function waitingQuery(user: WaitingActor, scope: Scope, plan: string) {
  return oldestWaitingWhatsappQuery({
    agencyId: user.agencyId,
    user: { role: user.role },
    gotPermIds: scope.gotPermIds,
    plan,
  })
}

/** True COUNT of waiting-reply conversations. Never derived from a LIMIT preview. */
export async function countWaitingWhatsappConversations(user: WaitingActor, scope: Scope): Promise<number> {
  try {
    const plan = await getEffectiveLeadPlan(user.agencyId)
    const row = await waitingQuery(user, scope, plan).clearSelect().countDistinct({ n: 'cv.id' }).first()
    return Number((row as { n?: number | string } | undefined)?.n ?? 0)
  } catch {
    return 0
  }
}

/** Existing waiting-reply reader. Fail closed. Preview is capped; total is not. */
export async function listWaitingWhatsappRows(
  user: WaitingActor,
  scope: Scope,
  order: 'asc' | 'desc',
): Promise<WaitingWhatsappLead[]> {
  try {
    const plan = await getEffectiveLeadPlan(user.agencyId)
    const rows = await waitingQuery(user, scope, plan)
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
  user: WaitingActor,
  scope: Scope,
): Promise<BriefingLeadList> {
  const [rows, total] = await Promise.all([listWaitingWhatsappRows(user, scope, 'asc'), countWaitingWhatsappConversations(user, scope)])
  return {
    total,
    sample: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })),
  }
}
