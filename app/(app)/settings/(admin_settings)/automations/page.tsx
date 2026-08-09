import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { listDefinitions } from '@/db/automations/definitions'
import { countAutomatedTodayForAgency, countRecentActivityByAutomation } from '@/db/automations/activity'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { getAutomationsFrom, getAutomationsSendMode, isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { startOfBusinessDayMs } from '@/lib/today/time'
import { resolveSenderIdentity } from '@/lib/automations/identity'
import { eventKeyForEngineTrigger } from '@/lib/automations/catalog/engineBridge'
import { actionKeyFor } from '@/lib/automations/actionEntry'
import { listAllConnections, resolveCapabilities } from '@/lib/automations/connectors/registry'
import { templateOverview } from '@/lib/automations/templates/overview'
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

  // Midnight in the BUSINESS's day, not the server's. Vercel runs UTC while the
  // business runs Asia/Jerusalem, so "today" has to come from the canonical
  // helper (architecture-rules §11) rather than from the process clock.
  const startOfToday = new Date(startOfBusinessDayMs(Date.now()))

  // The agency-wide activity feed is no longer read here: the workspace shows
  // activity per automation, on demand, through the log modal.
  const [definitions, counts, todayRuns, agencyName, replyTo, connections, capabilities, templates] =
    await Promise.all([
    listDefinitions(user.agencyId),
    countRecentActivityByAutomation(user.agencyId, new Date(Date.now() - WEEK_MS)),
    countAutomatedTodayForAgency(user.agencyId, startOfToday),
    getAgencyName(user.agencyId),
    getAgencyReplyTo(user.agencyId),
    listAllConnections(user.agencyId),
    resolveCapabilities(user.agencyId),
    templateOverview(user.agencyId),
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
    actionKey: actionKeyFor(d),
    connectionProblem: connectionProblems.get(d.id) ?? false,
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
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
      // Both halves or no block — rows written before the CTA existed have
      // neither, and a half-filled pair is not a block.
      cta:
        d.content?.ctaLabel && d.content?.ctaUrl
          ? { label: d.content.ctaLabel, url: d.content.ctaUrl }
          : null,
      /**
       * Which action this automation runs, so opening it for edit reopens the
       * configuration it was saved with. Without this the sheet would fall back to
       * the event's first offerable action and show an email form for a WhatsApp
       * automation — the same class of silent overwrite the timing round-trip fixed.
       */
      actionKey: actionKeyFor(d),
      templateId: d.content?.templateId ?? null,
      templateBindings: d.content?.templateBindings ?? null,
      timing: d.content?.timing ?? { kind: 'preset', preset: 'immediate' },
    }
  }

  return (
    <AutomationsSettings
      requirementContext={requirementContext}
      connections={connections}
      automations={automations}
      drafts={drafts}
      templates={JSON.parse(JSON.stringify(templates))}
      todayRuns={todayRuns}
      previewName={recentLead?.firstName ?? null}
      identityProblem={sender.problem}
      observationMode={getAutomationsSendMode() === 'log'}
    />
  )
}
