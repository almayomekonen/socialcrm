import ConnectionNotice from '@/components/settings/ConnectionNotice'
import type { Translator } from '@/lib/i18n/translate'

/** Shown above every composer state while the customer is opted out. */
export default function WhatsappOptOutNotice({ t }: { t: Translator }) {
  return (
    <ConnectionNotice
      notice={{
        tone: 'attention',
        title: t('inbox.optOut.title'),
        explanation: t('inbox.optOut.explanation'),
        reasons: [t('inbox.optOut.automated'), t('inbox.optOut.manual'), t('inbox.optOut.templates')],
      }}
      reasonsLabel={t('inbox.optOut.reasonsLabel')}
    />
  )
}
