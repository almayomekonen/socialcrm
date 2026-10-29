import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Calm, reassuring notice for a ready-made message awaiting WhatsApp review —
 * the sibling of `TemplateRejectionNotice`, in the same status box (attention
 * tone, matching the pending badge). It makes the wait legible: the message was
 * submitted to WhatsApp, no user action is needed, and it becomes sendable
 * automatically on approval. Pure presentation — no state, no functionality.
 */
const PENDING_NOTICE: Notice = {
  tone: 'attention',
  title: 'ההודעה נשלחה לאישור וואטסאפ',
  explanation: 'אין צורך לעשות דבר — ברגע שתאושר, היא תהיה מוכנה לשליחה.',
}

export default function TemplatePendingNotice() {
  const t = useT()
  const notice = t.locale === 'he' ? PENDING_NOTICE : { ...PENDING_NOTICE, title: t('settings.templates.pending.title'), explanation: t('settings.templates.pending.explanation') }
  return <ConnectionNotice notice={notice} />
}
