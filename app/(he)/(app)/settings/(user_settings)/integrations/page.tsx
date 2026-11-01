import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import LeadSourcesSection from '@/components/settings/integrations/LeadSourcesSection'
import ConnectedToolsSection from '@/components/settings/integrations/ConnectedToolsSection'
import IntegrationsMobile from '@/modules/settings/mobile/IntegrationsMobile'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('settings.account.title.integrations') }
}

/**
 * Settings → אינטגרציות — the single place every external system is connected.
 *
 * It replaces four surfaces (ערוצי לידים, יומן Google, אינטגרציות, חיבורים)
 * that each owned one or two systems, so a system could appear twice or be
 * findable only by knowing which of the four to open. Every system now appears
 * exactly once, under the heading that answers the only question a business
 * asks about it: does connecting this bring me לידים, or does it make the
 * לידים I already have better?
 *
 * Navigation stays one item; the page does the separating.
 *
 * The old routes are redirect stubs, not deletions — `?section=` deep links
 * live in OAuth callbacks, in-app CTAs and already-delivered customer email.
 * A new system is added by registering it (catalog entry or connector); the
 * only edit here would be a third heading, which so far nothing needs.
 */
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const user = await requireAgencyUser()

  // Read server-side so refresh and Back/Forward restore the open section with
  // no client state — UrlSyncedAccordion only writes the param back.
  const sp = (searchParams ? await searchParams : {}) || {}
  const { section } = sp
  const activeSection = typeof section === 'string' ? section : null

  if (await isMobileWorkspaceRequest(user.agencyId)) {
    // The layout's request-memoised read: the phone screens are worded in it.
    const { locale: mobileLocale } = await getUiLocaleState(user)
    return <IntegrationsMobile user={user} searchParams={sp} locale={mobileLocale} />
  }

  /**
   * CONNECTION STATE IS NOT ENTITLEMENT STATE.
   *
   * Both connectors report "החיבור תקין — לידים מגיעים אוטומטית", which is TRUE
   * at the integration layer and misleading at the product layer: the audit found
   * it displayed while the inbox those integrations feed was refusing every
   * request. The connector copy is left alone — it is accurate about the
   * connection — and the subscription fact is stated once, above the list, so the
   * two are not confused.
   */
  const productAccess = await getAgencyProductAccess(user.agencyId)
  // Desktop only (the phone branch above is Phase F): resolved once, passed down.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)

  return (
    <div {...regionAttrs(locale)}>
      {!productAccess.hasAccess && (
        <div className='mb-6 max-w-lg'>
          <SubscriptionExpiredState
            mode='inline'
            source='integrations_page'
            feature={t('settings.integrations.expired')}
            translated
          />
        </div>
      )}
      <h1 className='title'>{t('settings.account.title.integrations')}</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        {t('settings.integrations.intro')}
      </p>

      <section className='mb-10'>
        <h2 className='text-xl font-bold text-dark'>{t('settings.integrations.sources.title')}</h2>
        <p className='mt-1 mb-4 max-w-2xl text-sm text-gray-600'>{t('settings.integrations.sources.intro')}</p>
        {/* max-w-lg is the width the Facebook/WhatsApp accordion shipped with
            on /settings/facebook. Kept as-is: the connect forms were laid out
            for it, and widening the accordion was never part of the fix. */}
        <div className='max-w-lg'>
          <LeadSourcesSection user={user} activeSection={activeSection} locale={locale} />
        </div>
      </section>

      <section>
        <h2 className='text-xl font-bold text-dark'>{t('settings.integrations.tools.title')}</h2>
        <p className='mt-1 mb-4 max-w-2xl text-sm text-gray-600'>{t('settings.integrations.tools.intro')}</p>
        <ConnectedToolsSection user={user} />
      </section>
    </div>
  )
}
