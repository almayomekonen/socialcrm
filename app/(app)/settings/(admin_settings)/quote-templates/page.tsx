import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { canManageQuoteTemplates } from '@/lib/quotes/permissions'
import { loadQuoteTemplateWorkspace } from '@/db/quotes/templateWrites'
import QuoteTemplatesSettings from '@/components/quotes/QuoteTemplatesSettings'

export const metadata: Metadata = { title: 'תבניות הצעות מחיר' }

/**
 * Settings → תבניות הצעות מחיר.
 *
 * Placed in the `(admin_settings)` route group beside תבניות משימות and
 * אוטומציות, because deciding what the business charges is configuration rather
 * than day-to-day lead work. The group's layout already blocks non-admins; the
 * predicate is checked here anyway so the page and the Server Actions share ONE
 * authority rather than relying on where a file happens to sit.
 *
 * The editable documents load WITH the list, from the same two queries — an
 * agency has tens of templates, so carrying them removes a round-trip-on-open
 * and the editor opens with the real values already in it.
 */
export default async function QuoteTemplatesPage() {
  const user = await requireAgencyUser()
  if (!canManageQuoteTemplates(user)) return <div className='max-w-3xl'>אין לך הרשאה לצפות בדף זה</div>
  /*
   * Pure-configuration page: every control on it calls a
   * requireProductAccess-guarded action. Left open to a lapsed
   * subscription, each button was a doomed request that surfaced as a
   * generic toast or an unhandled Server Action rejection. Same page-level
   * lock the notifications page already uses; no customer DATA is hidden by
   * it, only settings the customer cannot change right now.
   *
   * Runs AFTER the existing permission/availability check: who you are is a
   * stronger statement than what your plan currently covers, and telling
   * someone who could never use this page that their subscription ended
   * would simply be wrong.
   */
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return <SubscriptionExpiredState mode='page' source='quote_templates_settings' feature='תבניות הצעות המחיר מושהות.' />
  }

  const { overviews, documents } = await loadQuoteTemplateWorkspace(user.agencyId)

  return <QuoteTemplatesSettings templates={overviews} drafts={documents} />
}
