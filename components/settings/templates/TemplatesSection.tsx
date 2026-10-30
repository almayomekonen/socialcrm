import { Suspense } from 'react'
import Link from 'next/link'
import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { StatusBadge } from '@/lib/StatusBadge'
import { listTemplates, countByStatus } from '@/db/whatsappTemplates'
import TemplateListSkeleton from './TemplateListSkeleton'
import TemplatesWorkspace from '@/modules/templates/client/templatesStore'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

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
  explanation: 'כדי ליצור הודעות WhatsApp מוכנות, חברו קודם את מספר הוואטסאפ העסקי.',
}

const NOT_READY: Notice = {
  tone: 'attention',
  title: 'חיבור הוואטסאפ עדיין לא מוכן',
  explanation: 'לאחר שהחיבור יאומת, אפשר יהיה ליצור הודעות WhatsApp מוכנות.',
}

type Props = { agencyId: number; connected: boolean; messagingReady: boolean; locale?: UiLocale }

/** The two notices in `locale` (Hebrew: the constants above, unchanged). */
function notice(base: Notice, keys: { title: 'settings.templates.notConnected.title' | 'settings.templates.notReady.title'; explanation: 'settings.templates.notConnected.explanation' | 'settings.templates.notReady.explanation' }, locale: UiLocale): Notice {
  if (locale === 'he') return base
  const t = translatorFor(locale)
  return { ...base, title: t(keys.title), explanation: t(keys.explanation) }
}

/** Loads and renders the list; wrapped in Suspense above for the skeleton. Exported for tests. */
export async function TemplatesBody({ agencyId }: { agencyId: number }) {
  const templates = await listTemplates(agencyId)
  return <TemplatesWorkspace initial={templates} />
}

export default function TemplatesSection({ agencyId, connected, messagingReady, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  if (!connected) {
    return (
      <div className='grid gap-3'>
        <ConnectionNotice notice={notice(NOT_CONNECTED, { title: 'settings.templates.notConnected.title', explanation: 'settings.templates.notConnected.explanation' }, locale)} />
        <Link
          href='/settings/integrations?section=whatsapp'
          className='text-sm font-medium text-primary hover:underline'
        >
          {t('settings.templates.goConnect')}
        </Link>
      </div>
    )
  }

  if (!messagingReady) {
    return <ConnectionNotice notice={notice(NOT_READY, { title: 'settings.templates.notReady.title', explanation: 'settings.templates.notReady.explanation' }, locale)} />
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
export async function TemplatesHeaderBadge({ agencyId, connected, locale = 'he' }: { agencyId: number; connected: boolean; locale?: UiLocale }) {
  const t = translatorFor(locale)
  if (!connected) return null
  const counts = await countByStatus(agencyId)
  const approved = counts.approved ?? 0
  const pending = counts.pending ?? 0
  if (approved === 0 && pending === 0) return null
  return (
    <span className='flex items-center gap-1'>
      {approved > 0 && <StatusBadge role='success' size='xs' label={t('settings.templates.badge.approved', { count: approved })} />}
      {pending > 0 && <StatusBadge role='warning' size='xs' label={t('settings.templates.badge.pending', { count: pending })} />}
    </span>
  )
}
