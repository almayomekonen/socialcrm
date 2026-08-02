import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getPilotMetrics } from '@/db/automations/pilotMetrics'
import {
  getAutomationsSendMode,
  isAutomationsAgencyAllowlisted,
  isAutomationsPilotDashboardEnabled,
} from '@/lib/automations/flags'
import PilotDashboard from '@/components/settings/automations/PilotDashboard'

/**
 * INTERNAL pilot dashboard (ADR-014 §Monitoring). Not linked from the
 * customer nav — reachable only by direct URL, only for an allowlisted
 * agency, only while AUTOMATIONS_PILOT_DASHBOARD=1, and only for admins
 * (enforced by the (admin_settings) layout). Three gates, all off by default.
 *
 * Agency-scoped by deliberate design; see db/automations/pilotMetrics.ts for
 * why there is no cross-tenant view.
 */

export const metadata: Metadata = { title: 'מדדי פיילוט' }

export default async function AutomationsPilotPage() {
  const user = await requireAgencyUser()

  if (!isAutomationsPilotDashboardEnabled() || !isAutomationsAgencyAllowlisted(user.agencyId)) {
    return <div className='max-w-3xl'>הדף אינו זמין.</div>
  }

  const metrics = await getPilotMetrics(user.agencyId, 30)
  return <PilotDashboard metrics={metrics} mode={getAutomationsSendMode()} />
}
