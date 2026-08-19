import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { isMobileWorkspaceRequest } from '@/lib/device'
import LeadSourcesSection from '@/components/settings/integrations/LeadSourcesSection'
import ConnectedToolsSection from '@/components/settings/integrations/ConnectedToolsSection'
import IntegrationsMobile from '@/modules/settings/mobile/IntegrationsMobile'

export const metadata: Metadata = { title: 'אינטגרציות' }

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
    return <IntegrationsMobile user={user} searchParams={sp} />
  }

  return (
    <div>
      <h1 className='title'>אינטגרציות</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        חברו כאן את המערכות שמהן מגיעים הלידים, ואת הכלים שעוזרים לטפל בהם. החיבור מתבצע פעם אחת.
      </p>

      <section className='mb-10'>
        <h2 className='text-xl font-bold text-dark'>מקורות לידים</h2>
        <p className='mt-1 mb-4 max-w-2xl text-sm text-gray-600'>מכאן נכנסים לידים חדשים למערכת, אוטומטית.</p>
        {/* max-w-lg is the width the Facebook/WhatsApp accordion shipped with
            on /settings/facebook. Kept as-is: the connect forms were laid out
            for it, and widening the accordion was never part of the fix. */}
        <div className='max-w-lg'>
          <LeadSourcesSection user={user} activeSection={activeSection} />
        </div>
      </section>

      <section>
        <h2 className='text-xl font-bold text-dark'>כלים מחוברים</h2>
        <p className='mt-1 mb-4 max-w-2xl text-sm text-gray-600'>שירותים חיצוניים שמעשירים את הלידים הקיימים.</p>
        <ConnectedToolsSection user={user} />
      </section>
    </div>
  )
}
