import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPilotMetrics } from '@/db/automations/pilotMetrics'
import {
  getAutomationsSendMode,
  isAutomationsAgencyAllowlisted,
  isAutomationsPilotDashboardEnabled,
} from '@/lib/automations/flags'
import PilotDashboard from '@/components/settings/automations/PilotDashboard'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * INTERNAL pilot dashboard (ADR-014 §Monitoring). Not linked from the
 * customer nav — reachable only by direct URL, only for an allowlisted
 * agency, only while AUTOMATIONS_PILOT_DASHBOARD=1, and only for admins
 * (enforced by the (admin_settings) layout). Three gates, all off by default.
 *
 * Agency-scoped by deliberate design; see db/automations/pilotMetrics.ts for
 * why there is no cross-tenant view.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await requireAgencyUser())
  return { title: t('admin.automations.pilot.title') }
}

export default async function AutomationsPilotPage() {
  const user = await requireAgencyUser()
  const { locale } = await getUiLocaleState(user)

  if (!isAutomationsPilotDashboardEnabled() || !isAutomationsAgencyAllowlisted(user.agencyId)) {
    return <div className='max-w-3xl' {...regionAttrs(locale)}>{translatorFor(locale)('admin.automations.pilot.notAvailable')}</div>
  }

  const metrics = await getPilotMetrics(user.agencyId, 30)
  return <PilotDashboard metrics={metrics} mode={getAutomationsSendMode()} locale={locale} />
}
