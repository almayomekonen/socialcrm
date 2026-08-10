import 'server-only'
import { deliveryFacts } from '@/db/automations/connectionDelivery'
import { intakeErrorCopy, isFailingIntake } from './intakeErrors'

/**
 * The one question the leads page asks: is any lead source refusing what
 * arrives, badly enough to say so?
 *
 * Deliberately NOT `integrationOverview`. That assembles the whole settings
 * page — every connector's sources, labels, usage and health — which is several
 * provider round trips for a banner that is almost always absent. This reads one
 * table and decides.
 *
 * The connection's display name is not fetched either: the customer-facing copy
 * names the SOURCE in their terms ("הטופס באתר"), and a connection's internal
 * label would be a second, less useful name for the same thing.
 */

export type IntakeAlert = {
  connectionId: string
  title: string
  short: string
  action?: { label: string; href: string }
}

export async function intakeAlerts(agencyId: number): Promise<IntakeAlert[]> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return []

  const facts = await deliveryFacts(agencyId)
  const alerts: IntakeAlert[] = []

  for (const [connectionId, f] of Object.entries(facts)) {
    if (!isFailingIntake(f)) continue
    const copy = intakeErrorCopy(f.lastRejectionReason)
    if (!copy) continue
    alerts.push({ connectionId, title: copy.title, short: copy.short, action: copy.action })
  }

  return alerts
}
