'use client'

import type { ThreadQuote } from '@/lib/inbox/whatsappThreadView'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'

const HEBREW = translatorFor('he')

/**
 * The message a reply quotes, above the reply's text, as WhatsApp shows it: one
 * line of the quoted message, or "a reply to an earlier message" when that
 * message is not in this thread. Shared by the desktop and mobile threads.
 *
 * `translated`: the caller follows the interface language (the desktop inbox);
 * off by default, so the mobile thread keeps Hebrew. The quoted line itself is
 * the customer's text and is never translated.
 */
export default function WhatsappQuoteStrip({ quote, translated = false }: { quote: ThreadQuote; translated?: boolean }) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  return (
    <p className='mb-1 truncate rounded-md border-s-2 border-gray-400 bg-black/5 px-2 py-1 text-xs leading-snug text-gray-600'>
      <span className='sr-only'>{t('inbox.quote.label')}: </span>
      {quote.preview ?? t('inbox.quote.notFound')}
    </p>
  )
}
