import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { canManageQuoteTemplates } from '@/lib/quotes/permissions'
import { loadQuoteTemplateWorkspace } from '@/db/quotes/templateWrites'
import QuoteTemplatesSettings from '@/components/quotes/QuoteTemplatesSettings'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await requireAgencyUser())
  return { title: t('admin.quotes.title') }
}

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
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  if (!canManageQuoteTemplates(user)) return <div className='max-w-3xl' {...regionAttrs(locale)}>{t('admin.quotes.noPermission')}</div>

  /*
   * TIER 2. The page stays readable: an expired customer can still see what
   * they built and what the product does for them. Only the actions that spend
   * money stay gated, each at its own control, so this surface teaches value
   * instead of turning into a wall.
   */
  const proLocked = !(await getAgencyProductAccess(user.agencyId)).hasAccess

  const { overviews, documents } = await loadQuoteTemplateWorkspace(user.agencyId)

  return (
    <>
      {proLocked && (
        <div className='mb-6 max-w-2xl' {...regionAttrs(locale)}>
          <SubscriptionExpiredState
            mode='inline'
            source='quote_templates_settings'
            feature={t('admin.quotes.expiredFeature')}
            translated
          />
        </div>
      )}
      <QuoteTemplatesSettings templates={overviews} drafts={documents} />
    </>
  )
}
