import { Suspense } from 'react'
import Link from 'next/link'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { StatusBadge } from '@/lib/StatusBadge'
import { listTemplates, countByStatus } from '@/db/whatsappTemplates'
import TemplateList from './TemplateList'
import TemplatesEmptyState from './TemplatesEmptyState'
import TemplateListSkeleton from './TemplateListSkeleton'

/**
 * Ready-made messages section body (RSC). Connection-gated per UX spec §1:
 * not-connected / not-ready → a connect-first notice; connected + ready →
 * empty state or the list. Exactly one state renders at a time.
 *
 * Read-only in Sprint 2: the create modal, actions, and live updates come later.
 */

const NOT_CONNECTED: Notice = {
  tone: 'attention',
  title: 'צריך לחבר וואטסאפ עסקי',
  explanation: 'כדי ליצור הודעות מוכנות, חברו קודם את מספר הוואטסאפ העסקי.',
}

const NOT_READY: Notice = {
  tone: 'attention',
  title: 'חיבור הוואטסאפ עדיין לא מוכן',
  explanation: 'לאחר שהחיבור יאומת, אפשר יהיה ליצור הודעות מוכנות.',
}

type Props = { agencyId: number; connected: boolean; messagingReady: boolean }

/** Loads and renders the list; wrapped in Suspense above for the skeleton. Exported for tests. */
export async function TemplatesBody({ agencyId }: { agencyId: number }) {
  const templates = await listTemplates(agencyId)
  return templates.length === 0 ? <TemplatesEmptyState /> : <TemplateList templates={templates} />
}

export default function TemplatesSection({ agencyId, connected, messagingReady }: Props) {
  if (!connected) {
    return (
      <div className='grid gap-3'>
        <ConnectionNotice notice={NOT_CONNECTED} />
        <Link href='/settings/facebook?section=whatsapp' className='text-sm font-medium text-primary hover:underline'>
          למעבר לחיבור וואטסאפ
        </Link>
      </div>
    )
  }

  if (!messagingReady) {
    return <ConnectionNotice notice={NOT_READY} />
  }

  return (
    <Suspense fallback={<TemplateListSkeleton />}>
      <TemplatesBody agencyId={agencyId} />
    </Suspense>
  )
}

/**
 * Accordion-summary badge (RFC §2 / UX §2): a glanceable status when connected.
 * Renders nothing until there is something worth advertising — and never a red
 * "rejected" count on the closed header (care-charter Law 13).
 */
export async function TemplatesHeaderBadge({ agencyId, connected }: { agencyId: number; connected: boolean }) {
  if (!connected) return null
  const counts = await countByStatus(agencyId)
  const approved = counts.approved ?? 0
  const pending = counts.pending ?? 0
  if (approved > 0) return <StatusBadge role='success' label={`${approved} מוכנות`} />
  if (pending > 0) return <StatusBadge role='warning' label='בבדיקה' />
  return null
}
