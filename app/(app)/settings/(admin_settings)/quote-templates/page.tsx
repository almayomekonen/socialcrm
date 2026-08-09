import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
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

  const { overviews, documents } = await loadQuoteTemplateWorkspace(user.agencyId)

  return <QuoteTemplatesSettings templates={overviews} drafts={documents} />
}
