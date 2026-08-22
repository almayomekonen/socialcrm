'use server'

import { requireBasicCrmAccess } from '@/lib/requireUser'
import { getMobileLeadList, type MobileLeadRow } from '@/modules/leads/queries'
import { LEAD_STATUSES, type LeadFilters } from '@/modules/leads/filters'

/**
 * The next batch of mobile leads, for the "טען עוד" control.
 *
 * NOT A SECOND PAGINATION MECHANISM. It is a thin Server Action over the
 * EXISTING `getMobileLeadList(user, filters, page)` — the same query, the same
 * page size, the same filter shape the server-rendered first batch uses. The
 * only thing that changes is who asks for batch N: the URL used to (`?page=`,
 * which swapped the whole list), and now the client does, appending.
 *
 * TIER 1. Reading leads is basic CRM and stays free, so the guard is
 * `requireBasicCrmAccess` — the same guard the leads page itself uses. Using
 * `requireProductAccess` here would silently paywall scrolling a list that is
 * deliberately open, which is exactly the kind of over-gating the three-tier
 * policy exists to prevent.
 *
 * Tenant scoping is unchanged: `getMobileLeadList` resolves permissions from the
 * session user, so a caller cannot widen its own visibility by passing filters.
 * `page` is clamped because it arrives from the client.
 */
export async function loadMoreMobileLeads(
  filters: LeadFilters,
  page: number,
): Promise<{ rows: MobileLeadRow[]; hasMore: boolean; page: number }> {
  const user = await requireBasicCrmAccess()
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safeFilters: LeadFilters = {
    q: typeof filters?.q === 'string' ? filters.q : '',
    // Re-validate against the known vocabulary rather than trusting the client.
    status: Array.isArray(filters?.status)
      ? filters.status.filter((s) => (LEAD_STATUSES as readonly string[]).includes(s))
      : [],
  }
  return getMobileLeadList(user, safeFilters, safePage)
}
