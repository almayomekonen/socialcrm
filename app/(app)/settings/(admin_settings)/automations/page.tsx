import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { listDefinitions } from '@/db/automations/definitions'
import { countRecentActivityByAutomation } from '@/db/automations/activity'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { getAutomationsFrom, getAutomationsSendMode, isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { resolveSenderIdentity } from '@/lib/automations/identity'
import { eventKeyForEngineTrigger } from '@/lib/automations/catalog/engineBridge'
import { listAllConnections, resolveCapabilities } from '@/lib/automations/connectors/registry'
import { isConnectionProblem } from '@/lib/automations/connectors/resolve'
import AutomationsSettings from '@/components/settings/automations/AutomationsSettings'
import type { AutomationCardData } from '@/components/settings/automations/AutomationCard'
import type { SheetDraft } from '@/components/settings/automations/AutomationSheet'

export const metadata: Metadata = { title: 'אוטומציות' }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export default async function AutomationsSettingsPage() {
  const user = await requireAgencyUser()

  // Flag-gated like the ai-inspector entry: a non-allowlisted agency sees
  // neither the nav item nor this page.
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) {
    return <div className='max-w-3xl'>הדף אינו זמין בחשבון הזה.</div>
  }

  const [definitions, counts, agencyName, replyTo, connections, capabilities] = await Promise.all([
    listDefinitions(user.agencyId),
    countRecentActivityByAutomation(user.agencyId, new Date(Date.now() - WEEK_MS)),
    getAgencyName(user.agencyId),
    getAgencyReplyTo(user.agencyId),
    listAllConnections(user.agencyId),
    resolveCapabilities(user.agencyId),
  ])

  /**
   * A bound connection that is gone or unhealthy makes its automations
   * un-runnable. Surfacing that as דורש טיפול is what keeps the failure from
   * being silent — "no silent failures" is the B4 rule.
   *
   * Health is read off the connection list already fetched above: asking the
   * Connection layer once per automation would re-hit every integration N
   * times for the same answer.
   */
  const healthById = new Map(connections.map((c) => [c.id, c.health]))
  const connectionProblems = new Map<number, boolean>()
  for (const d of definitions) {
    if (!d.connectionId) continue
    connectionProblems.set(d.id, isConnectionProblem(healthById.get(d.connectionId) ?? null))
  }

  // Entitlements and flags are not gated for automations yet; the Requirement
  // Runtime already supports both the moment they are.
  const requirementContext = {
    capabilities,
    entitlements: new Set<string>(),
    flags: new Set<string>(),
  }

  // A real recent lead's first name, so the sheet's preview shows what the
  // business will actually send rather than a placeholder (spec §7).
  const recentLead = (await db('clients')
    .select('firstName')
    .where({ agencyId: user.agencyId, lead: true })
    .whereNotNull('firstName')
    .orderBy('id', 'desc')
    .first()) as { firstName: string | null } | undefined

  const sender = resolveSenderIdentity({ agencyName, replyTo }, getAutomationsFrom())

  const automations: AutomationCardData[] = definitions.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    eventKey: eventKeyForEngineTrigger(d.trigger) ?? '',
    conditions: d.conditions,
    subject: d.content?.subject ?? '',
    timing: d.content?.timing ?? { kind: 'preset', preset: 'immediate' },
    counts: counts[d.id] ?? { sent: 0, wouldSend: 0, skipped: 0, failed: 0 },
    connectionProblem: connectionProblems.get(d.id) ?? false,
  }))

  const drafts: Record<number, SheetDraft> = {}
  for (const d of definitions) {
    drafts[d.id] = {
      id: d.id,
      name: d.name,
      recipeKey: d.recipeKey,
      eventKey: eventKeyForEngineTrigger(d.trigger) ?? '',
      conditions: d.conditions,
      connectionId: d.connectionId,
      parameters: {},
      subject: d.content?.subject ?? '',
      body: d.content?.body ?? '',
      timing: d.content?.timing ?? { kind: 'preset', preset: 'immediate' },
    }
  }

  return (
    <AutomationsSettings
      requirementContext={requirementContext}
      connections={connections}
      automations={automations}
      drafts={drafts}
      previewName={recentLead?.firstName ?? null}
      identityProblem={sender.problem}
      observationMode={getAutomationsSendMode() === 'log'}
    />
  )
}
