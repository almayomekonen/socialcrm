import type { MessengerConversationEvent } from '../types'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * A non-message event in the timeline: a button or menu tap, or the entry point
 * the customer arrived through.
 *
 * WHY IT IS SHOWN AT ALL. Without it a conversation that begins with "Get
 * Started" or arrives from an ad opens with no explanation of where the person
 * came from — and a rep answering "מה שלחת?" has no way to know the customer
 * tapped a menu item rather than typed. It is context for the reply.
 *
 * WHY IT IS QUIET. It is a centred grey line, not a bubble: nobody said this.
 * Reactions are not rendered here — they belong on the message they refer to.
 *
 * NOTHING IS INVENTED. Only what Meta sent is shown; a payload with no label
 * falls back to a generic description rather than a guessed one.
 */

/**
 * Meta's referral sources we know, by Meta's own code. The button label (`title`)
 * and the referral ref (`payload`) are what Meta sent — shown as written.
 */
const REFERRAL_SOURCE: Record<string, MessageKey> = {
  ADS: 'inbox.messenger.event.referral.ADS',
  SHORTLINK: 'inbox.messenger.event.referral.SHORTLINK',
  MESSENGER_CODE: 'inbox.messenger.event.referral.MESSENGER_CODE',
  DISCOVER_TAB: 'inbox.messenger.event.referral.DISCOVER_TAB',
  CUSTOMER_CHAT_PLUGIN: 'inbox.messenger.event.referral.CUSTOMER_CHAT_PLUGIN',
}

export function describeMessengerEvent(event: MessengerConversationEvent, locale: UiLocale = 'he'): string | null {
  const t = translatorFor(locale)
  if (event.kind === 'postback') {
    // Meta sends the button's visible label as `title`; that is what the
    // customer actually saw, so it is what the rep is shown.
    if (event.title) return t('inbox.messenger.event.chose', { title: event.title })
    return event.payload === 'GET_STARTED' ? t('inbox.messenger.event.getStarted') : t('inbox.messenger.event.menu')
  }
  if (event.kind === 'referral') {
    // An empty source stays empty, as it always did; an unknown one is "a link".
    const known = event.title ? REFERRAL_SOURCE[event.title] : undefined
    const base = event.title === '' ? '' : t(known ?? 'inbox.messenger.event.referral.link')
    return event.payload ? t('inbox.messenger.event.withRef', { source: base, ref: event.payload }) : base
  }
  if (event.kind === 'optin') return t('inbox.messenger.event.optin')
  // Reactions render on their message, not as a timeline line.
  return null
}

export default function MessengerEventLine({ event, locale = 'he' }: { event: MessengerConversationEvent; locale?: UiLocale }) {
  const text = describeMessengerEvent(event, locale)
  if (!text) return null
  return (
    <div className='flex justify-center py-1'>
      <span className='rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] text-gray-500'>{text}</span>
    </div>
  )
}
