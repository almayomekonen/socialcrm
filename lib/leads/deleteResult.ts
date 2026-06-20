/**
 * Shared contract for lead deletion blocked by the billing system.
 *
 * Lead rows referenced by billing tables use ON DELETE RESTRICT (issued financial
 * records must outlive the lead — see the billing migration doctrine). Deletion
 * must detect these BEFORE deleting, never surface the raw Postgres FK error.
 *
 * Pure module — imported by both the server action and the client UI.
 */

export type LeadBlockReason = 'billing_profile' | 'invoices' | 'financial_events'

export type BlockedLead = { id: number; name: string | null; reason: LeadBlockReason }

export type DeleteManyLeadsResult = {
  deletedCount: number
  blockedCount: number
  blockedLeads: BlockedLead[]
  /** Summary: the single reason if all blocked leads share one, 'mixed' if not, null if none blocked. */
  reason: LeadBlockReason | 'mixed' | null
}

/** Per-dependency Hebrew reason — the specific cause for one blocked lead. */
export const LEAD_BLOCK_REASON_TEXT: Record<LeadBlockReason, string> = {
  billing_profile: 'קיים פרופיל חיוב פעיל',
  invoices: 'קיימות חשבוניות עבור הליד',
  financial_events: 'קיימות תנועות כספיות עבור הליד',
}

export function blockReasonText(reason: LeadBlockReason): string {
  return LEAD_BLOCK_REASON_TEXT[reason]
}

function deletedClause(n: number): string {
  return n === 1 ? 'נמחק ליד אחד' : `נמחקו ${n} לידים`
}

/**
 * Compose the toast for a batch delete result. Pure + deterministic.
 *   - all deleted        → success "נמחקו N לידים בהצלחה"
 *   - some blocked        → success "נמחקו N לידים. <blocked clause>"
 *   - all blocked         → ban     "<blocked clause>"
 * A single blocked lead gets its specific reason; multiple get the generic line.
 */
export function deleteLeadsMessage(r: {
  deletedCount: number
  blockedCount: number
  blockedLeads: BlockedLead[]
}): { icon: 'success' | 'ban'; msg: string } {
  const { deletedCount, blockedCount, blockedLeads } = r

  if (deletedCount === 0 && blockedCount === 0) {
    return { icon: 'ban', msg: 'לא נמחקו לידים' }
  }

  if (blockedCount === 0) {
    return { icon: 'success', msg: deletedCount === 1 ? 'נמחק ליד אחד בהצלחה' : `נמחקו ${deletedCount} לידים בהצלחה` }
  }

  const blockedClause =
    blockedCount === 1
      ? `ליד אחד לא נמחק כי ${blockReasonText(blockedLeads[0].reason)}`
      : `${blockedCount} לידים לא נמחקו כי קיימות עבורם רשומות חיוב`

  if (deletedCount === 0) {
    return { icon: 'ban', msg: blockedClause }
  }
  return { icon: 'success', msg: `${deletedClause(deletedCount)}. ${blockedClause}` }
}
