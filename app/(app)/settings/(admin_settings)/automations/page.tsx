import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { db } from '@/config/db'
import { listDefinitions } from '@/db/automations/definitions'
import { countRecentActivityByAutomation } from '@/db/automations/activity'
import { getAgencyName, getAgencyReplyTo } from '@/db/automations/leadFacts'
import { getAutomationsFrom, getAutomationsSendMode, isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { resolveSenderIdentity } from '@/lib/automations/identity'
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

  const [definitions, counts, agencyName, replyTo] = await Promise.all([
    listDefinitions(user.agencyId),
    countRecentActivityByAutomation(user.agencyId, new Date(Date.now() - WEEK_MS)),
    getAgencyName(user.agencyId),
    getAgencyReplyTo(user.agencyId),
  ])

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
    trigger: d.trigger,
    sourceFilter: d.sourceFilter,
    targetStatus: d.targetStatus,
    subject: d.content?.subject ?? '',
    timing: d.content?.timing ?? { kind: 'preset', preset: 'immediate' },
    counts: counts[d.id] ?? { sent: 0, wouldSend: 0, skipped: 0, failed: 0 },
  }))

  const drafts: Record<number, SheetDraft> = {}
  for (const d of definitions) {
    drafts[d.id] = {
      id: d.id,
      name: d.name,
      recipeKey: d.recipeKey,
      trigger: d.trigger,
      sourceFilter: d.sourceFilter,
      targetStatus: d.targetStatus,
      subject: d.content?.subject ?? '',
      body: d.content?.body ?? '',
      timing: d.content?.timing ?? { kind: 'preset', preset: 'immediate' },
    }
  }

  return (
    <AutomationsSettings
      automations={automations}
      drafts={drafts}
      previewName={recentLead?.firstName ?? null}
      identityProblem={sender.problem}
      observationMode={getAutomationsSendMode() === 'log'}
    />
  )
}
