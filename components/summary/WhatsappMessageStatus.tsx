import Icon, { type IconNames } from '@/lib/Icon'
import type { InboxMessageStatus } from '@/db/inboxMessages'

/**
 * Delivery state indicator for an outbound WhatsApp bubble.
 *
 * `Icon` is an aria-hidden CSS mask: it carries NO accessible name and takes its
 * colour from `bg-*`, not `text-*`. The sr-only label is the only name this
 * control has, and it is what keeps colour from being the sole carrier of
 * meaning.
 *
 * `sent` deliberately does not claim delivery — it means Meta accepted the
 * message. Only a `delivered` webhook earns נמסר.
 */
const STATE: Partial<Record<InboxMessageStatus, { icon: IconNames; tone: string; label: string }>> = {
  sent: { icon: 'check', tone: 'bg-gray-500', label: 'נשלח — ממתין לאישור מסירה' },
  delivered: { icon: 'check-double', tone: 'bg-gray-500', label: 'נמסר' },
  read: { icon: 'check-double', tone: 'bg-primary', label: 'נקרא' },
  failed: { icon: 'circle-exclamation', tone: 'bg-error', label: 'לא נשלח' },
}

export default function WhatsappMessageStatus({ status }: { status: InboxMessageStatus }) {
  const state = STATE[status]
  if (!state) return null

  return (
    <span className='inline-flex shrink-0 items-center'>
      <span className='sr-only'>{state.label}</span>
      <Icon name={state.icon} className={`size-3.5 ${state.tone}`} />
    </span>
  )
}
