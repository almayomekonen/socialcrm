import type { FollowUpBadge } from './followUpBadge'
import type { MobileLeadRow } from '@/modules/leads/queries'

/** Server-stamped presentation fields live on the row; selection still uses `id` only. */
export type LeadListCard = MobileLeadRow & {
  recency: string
  followUp: FollowUpBadge | null
}

export function removeSelectedLeads(items: LeadListCard[], ids: ReadonlySet<number>): LeadListCard[] {
  if (ids.size === 0) return items
  return items.filter((row) => !ids.has(row.id))
}

export function restoreLeads(
  current: LeadListCard[],
  snapshot: LeadListCard[],
  ids: ReadonlySet<number>,
): LeadListCard[] {
  if (ids.size === 0) return current
  const byId = new Map<number, LeadListCard>()
  for (const row of current) byId.set(row.id, row)
  for (const row of snapshot) {
    if (ids.has(row.id)) byId.set(row.id, row)
  }
  const seen = new Set<number>()
  const out: LeadListCard[] = []
  for (const row of snapshot) {
    const next = byId.get(row.id)
    if (!next) continue
    out.push(next)
    seen.add(row.id)
  }
  for (const row of current) {
    if (!seen.has(row.id)) out.push(row)
  }
  return out
}

export function patchLead(
  items: LeadListCard[],
  id: number,
  patch: Partial<Pick<LeadListCard, 'status' | 'nextFollowUpAt' | 'followUp'>>,
): LeadListCard[] {
  return items.map((row) => (row.id === id ? { ...row, ...patch } : row))
}
