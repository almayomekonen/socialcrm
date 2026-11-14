import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { ConnectionNotice as Notice } from '@/lib/connections/messages'
import { useT } from '@/lib/i18n/I18nProvider'
import { templateSentence } from './templateCopy'

/**
 * The rejection reason for a declined ready-made message, in the same calm status
 * box as the connection notices (error tone). `failureText` is the already-mapped
 * Hebrew (never a raw Meta reason) resolved server-side. The "עריכה ושליחה מחדש" retry
 * action arrives in Sprint 5; here we surface the reason.
 */
export default function TemplateRejectionNotice({ failureText }: { failureText: string }) {
  const t = useT()
  const notice: Notice = { tone: 'error', title: t('settings.templates.rejectedTitle'), explanation: templateSentence(failureText, t) }
  return <ConnectionNotice notice={notice} />
}
