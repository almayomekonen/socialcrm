import Icon, { type IconNames } from '@/lib/Icon'
import type { MessengerMessage } from '../types'

/**
 * Delivery state for an outbound Messenger bubble.
 *
 * ONLY WHAT META ACTUALLY TOLD US. Messenger reports delivery and read as
 * `message_deliveries` / `message_reads` webhook events carrying a WATERMARK.
 * `deliveredAt` / `readAt` are set only when such an event arrived, so:
 *
 *   readAt      → נקרא      (Meta said the person opened it)
 *   deliveredAt → נמסר      (Meta said it reached the device)
 *   neither     → נשלח      (Meta accepted it and returned a mid — no more)
 *
 * "נשלח" deliberately does NOT claim delivery. A Page whose subscription omits
 * `message_deliveries`/`message_reads` simply never advances past it, which is
 * honest: the absence of a receipt is not evidence of non-delivery, and the UI
 * must not invent the difference. Same rule, same copy, as the WhatsApp inbox.
 *
 * `Icon` is an aria-hidden CSS mask with no accessible name; the sr-only label
 * is the only name, which is what keeps colour from being the sole carrier.
 */
const STATE: Record<'sent' | 'delivered' | 'read', { icon: IconNames; tone: string; label: string }> = {
  sent: { icon: 'check', tone: 'bg-gray-500', label: 'נשלח — ממתין לאישור מסירה' },
  delivered: { icon: 'check-double', tone: 'bg-gray-500', label: 'נמסר' },
  read: { icon: 'check-double', tone: 'bg-primary', label: 'נקרא' },
}

export default function MessengerMessageStatus({ message }: { message: MessengerMessage }) {
  // A receipt is about what the Page sent. An inbound message has no such state.
  if (message.direction !== 'outbound') return null

  const state = message.readAt ? STATE.read : message.deliveredAt ? STATE.delivered : STATE.sent
  return (
    <span className='inline-flex shrink-0 items-center'>
      <span className='sr-only'>{state.label}</span>
      <Icon name={state.icon} className={`size-3.5 ${state.tone}`} />
    </span>
  )
}
