import Icon, { type IconNames } from '@/lib/Icon'
import type { InboxMessageStatus } from '@/db/inboxMessages'
import { failureTooltip, type WhatsappErrorCategory } from '@/lib/inbox/whatsappErrorCopy'
import { HoverTooltip } from '@/components/ui/HoverTooltip'

/**
 * Delivery state indicator for an outbound WhatsApp bubble.
 *
 * `Icon` is an aria-hidden CSS mask: it carries NO accessible name and takes its
 * colour from `bg-*`, not `text-*`. The label text is the only name this control
 * has, and it is what keeps colour from being the sole carrier of meaning.
 *
 * `sent` deliberately does not claim delivery — it means Meta accepted the
 * message. Only a `delivered` webhook earns נמסר.
 *
 * On `failed` the icon becomes a hover/focus tooltip trigger that explains what
 * happened → why → what now, in plain language, chosen by the allowlisted failure
 * CATEGORY (never a raw Meta string/code). The tooltip renders through a body
 * portal so the Inbox scroll overflow cannot clip it.
 */
const STATE: Partial<Record<InboxMessageStatus, { icon: IconNames; tone: string; label: string }>> = {
  sent: { icon: 'check', tone: 'bg-gray-500', label: 'נשלח — ממתין לאישור מסירה' },
  delivered: { icon: 'check-double', tone: 'bg-gray-500', label: 'נמסר' },
  read: { icon: 'check-double', tone: 'bg-primary', label: 'נקרא' },
  failed: { icon: 'circle-exclamation', tone: 'bg-error', label: 'לא נשלח' },
}

export default function WhatsappMessageStatus({
  status,
  failureCategory,
}: {
  status: InboxMessageStatus
  // Allowlisted failure category from the message model (LeadWhatsappMessage.
  // failureCategory); non-null only when failed. Presentation-only — no new read.
  failureCategory?: WhatsappErrorCategory | null
}) {
  const state = STATE[status]
  if (!state) return null

  if (status === 'failed') {
    const tip = failureTooltip(failureCategory)
    return (
      <HoverTooltip
        className='inline-flex shrink-0 items-center rounded-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error'
        // Accessible name — the full guidance, so AT and touch users are never
        // left with only the (hover-only) visual panel; kept meaningful when closed.
        label={`${tip.title}. ${tip.explanation} ${tip.action}`}
        content={
          <>
            <p className='font-semibold text-gray-900'>{tip.title}</p>
            <p className='mt-0.5 text-gray-700'>{tip.explanation}</p>
            <p className='mt-1 text-gray-500'>{tip.action}</p>
          </>
        }
      >
        <Icon name={state.icon} className={`size-3.5 ${state.tone}`} />
      </HoverTooltip>
    )
  }

  return (
    <span className='inline-flex shrink-0 items-center'>
      <span className='sr-only'>{state.label}</span>
      <Icon name={state.icon} className={`size-3.5 ${state.tone}`} />
    </span>
  )
}
