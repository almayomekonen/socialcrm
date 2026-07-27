import Icon, { type IconNames } from '@/lib/Icon'
import type { InboxMessageStatus } from '@/db/inboxMessages'
import { failureTooltipText } from '@/lib/inbox/whatsappErrorCopy'

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

export default function WhatsappMessageStatus({
  status,
  failureText,
}: {
  status: InboxMessageStatus
  // Already-resolved mapped reason from the message model (LeadWhatsappMessage.
  // failureText); non-null only when failed. Presentation-only — no new read.
  failureText?: string | null
}) {
  const state = STATE[status]
  if (!state) return null

  // On failure, a self-contained native tooltip explains what happened and
  // attributes the status to WhatsApp; its text also becomes the sr-only name so
  // AT gets the same meaning. Other statuses are byte-for-byte unchanged: no
  // title (undefined → attribute omitted), sr-only stays the terse state label.
  const failureTip = status === 'failed' ? failureTooltipText(failureText) : undefined

  return (
    <span className='inline-flex shrink-0 items-center' title={failureTip}>
      <span className='sr-only'>{failureTip ?? state.label}</span>
      <Icon name={state.icon} className={`size-3.5 ${state.tone}`} />
    </span>
  )
}
