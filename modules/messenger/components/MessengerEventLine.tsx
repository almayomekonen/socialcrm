import type { MessengerConversationEvent } from '../types'

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

const REFERRAL_SOURCE: Record<string, string> = {
  ADS: 'הגיע ממודעה',
  SHORTLINK: 'הגיע מקישור m.me',
  MESSENGER_CODE: 'סרק קוד Messenger',
  DISCOVER_TAB: 'הגיע מלשונית הגילוי',
  CUSTOMER_CHAT_PLUGIN: 'פתח צ׳אט מהאתר',
}

export function describeMessengerEvent(event: MessengerConversationEvent): string | null {
  if (event.kind === 'postback') {
    // Meta sends the button's visible label as `title`; that is what the
    // customer actually saw, so it is what the rep is shown.
    if (event.title) return `בחר: ${event.title}`
    return event.payload === 'GET_STARTED' ? 'התחיל שיחה' : 'בחר אפשרות מהתפריט'
  }
  if (event.kind === 'referral') {
    const base = (event.title && REFERRAL_SOURCE[event.title]) ?? 'הגיע מקישור'
    return event.payload ? `${base} (${event.payload})` : base
  }
  if (event.kind === 'optin') return 'אישר לקבל הודעות'
  // Reactions render on their message, not as a timeline line.
  return null
}

export default function MessengerEventLine({ event }: { event: MessengerConversationEvent }) {
  const text = describeMessengerEvent(event)
  if (!text) return null
  return (
    <div className='flex justify-center py-1'>
      <span className='rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] text-gray-500'>{text}</span>
    </div>
  )
}
