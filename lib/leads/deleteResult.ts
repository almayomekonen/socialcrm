/**
 * Shared contract for lead deletion blocked by the billing system.
 *
 * Lead rows referenced by billing tables use ON DELETE RESTRICT (issued financial
 * records must outlive the lead — see the billing migration doctrine). Deletion
 * must detect these BEFORE deleting, never surface the raw Postgres FK error.
 *
 * Pure module — imported by both the server action and the client UI.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

export type LeadBlockReason = 'billing_profile' | 'invoices' | 'financial_events'

export type BlockedLead = { id: number; name: string | null; reason: LeadBlockReason }

export type DeleteManyLeadsResult = {
  deletedCount: number
  blockedCount: number
  blockedLeads: BlockedLead[]
  /** Summary: the single reason if all blocked leads share one, 'mixed' if not, null if none blocked. */
  reason: LeadBlockReason | 'mixed' | null
}

const REASON_KEY: Record<LeadBlockReason, MessageKey> = {
  billing_profile: 'leads.deleteResult.reason.billing_profile',
  invoices: 'leads.deleteResult.reason.invoices',
  financial_events: 'leads.deleteResult.reason.financial_events',
}

/** Per-dependency Hebrew reason — the specific cause for one blocked lead. */
export const LEAD_BLOCK_REASON_TEXT: Record<LeadBlockReason, string> = {
  billing_profile: blockReasonText('billing_profile'),
  invoices: blockReasonText('invoices'),
  financial_events: blockReasonText('financial_events'),
}

/** The reason in the interface language (Hebrew by default — what the server action and every other caller get). */
export function blockReasonText(reason: LeadBlockReason, locale: UiLocale = 'he'): string {
  return translatorFor(locale)(REASON_KEY[reason])
}

/**
 * Compose the toast for a batch delete result. Pure + deterministic.
 *   - all deleted        → success "נמחקו N לידים בהצלחה"
 *   - some blocked        → success "נמחקו N לידים. <blocked clause>"
 *   - all blocked         → ban     "<blocked clause>"
 * A single blocked lead gets its specific reason; multiple get the generic line.
 * `locale` is the interface language; Hebrew by default.
 */
export function deleteLeadsMessage(
  r: {
    deletedCount: number
    blockedCount: number
    blockedLeads: BlockedLead[]
  },
  locale: UiLocale = 'he',
): { icon: 'success' | 'ban'; msg: string } {
  const t = translatorFor(locale)
  const { deletedCount, blockedCount, blockedLeads } = r

  if (deletedCount === 0 && blockedCount === 0) {
    return { icon: 'ban', msg: t('leads.deleteResult.none') }
  }

  if (blockedCount === 0) {
    return { icon: 'success', msg: t('leads.deleteResult.allDeleted', { count: String(deletedCount) }) }
  }

  const blockedClause =
    blockedCount === 1
      ? t('leads.deleteResult.blockedOne', { reason: blockReasonText(blockedLeads[0].reason, locale) })
      : t('leads.deleteResult.blockedMany', { count: String(blockedCount) })

  if (deletedCount === 0) {
    return { icon: 'ban', msg: blockedClause }
  }
  return { icon: 'success', msg: `${t('leads.deleteResult.deleted', { count: String(deletedCount) })}. ${blockedClause}` }
}
