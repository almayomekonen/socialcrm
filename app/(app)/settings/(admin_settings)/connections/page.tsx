import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { integrationOverview } from '@/lib/automations/connectors/overview'
import ConnectionsSettings from '@/components/settings/connections/ConnectionsSettings'

export const metadata: Metadata = { title: 'חיבורים' }

/**
 * Settings → חיבורים.
 *
 * Every integration the catalog registers renders here, with no page edit: the
 * server assembles one view per `IntegrationDefinition` and the client draws
 * them. Adding a connector is a registry line; the card is automatic.
 *
 * Gated exactly like the automations page — a non-allowlisted agency sees
 * neither the nav item nor this page.
 */
export default async function ConnectionsSettingsPage() {
  const user = await requireAgencyUser()
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) {
    return <div className='max-w-3xl'>הדף אינו זמין בחשבון הזה.</div>
  }

  const views = await integrationOverview(user.agencyId)

  return (
    <div>
      <h1 className='title'>חיבורים</h1>
      <p className='mt-2 mb-6 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        כאן מחברים את המערכות שמהן מגיעים לידים ואירועים. אחרי החיבור אפשר לבנות עליהם אוטומציות.
      </p>
      <ConnectionsSettings views={views} />
    </div>
  )
}
