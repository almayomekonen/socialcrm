'use client'

import BottomSheet from '@/components/mobile/BottomSheet'
import Icon, { type IconNames } from '@/lib/Icon'
import { toast } from '@/lib/toast'
import useLongPress from '@/components/mobile/useLongPress'
import { formatTime } from '@/lib/dates'
import type { InboxMessageStatus, LeadWhatsappMessage } from '@/db/inboxMessages'

/**
 * Outbound ticks from the existing `status` field only.
 * `sent` = Meta accepted; `delivered` / `read` come from webhooks. Nothing else.
 */
const TICK: Partial<Record<InboxMessageStatus, { icon: IconNames; tone: string; label: string }>> = {
  sent: { icon: 'check', tone: 'bg-gray-500', label: 'נשלח — ממתין לאישור מסירה' },
  delivered: { icon: 'check-double', tone: 'bg-gray-500', label: 'נמסר' },
  read: { icon: 'check-double', tone: 'bg-[#53bdeb]', label: 'נקרא' },
  failed: { icon: 'circle-exclamation', tone: 'bg-error', label: 'לא נשלח' },
}

export function MessageBubbleMobile({
  message,
  onOpen,
}: {
  message: LeadWhatsappMessage
  onOpen: () => void
}) {
  const outbound = message.direction === 'outbound'
  const longPress = useLongPress(onOpen, Boolean(message.text?.trim()))
  const tick = outbound ? TICK[message.status] : undefined
  const failed = outbound && message.status === 'failed'

  return (
    <li className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
      <div
        data-testid='message-bubble'
        data-direction={message.direction}
        className={`max-w-[80%] break-words rounded-2xl px-3 py-1.5 text-[15px] leading-relaxed text-ink select-none [-webkit-touch-callout:none] ${
          failed
            ? 'rounded-es-sm border border-error-border bg-error-bg'
            : outbound
              ? 'rounded-es-sm bg-[#d9fdd3]'
              : 'rounded-ee-sm bg-white shadow-sm'
        }`}
        {...longPress}
      >
        <span className='sr-only'>{outbound ? 'הודעה שנשלחה מהמערכת' : 'הודעה נכנסת'}</span>
        <p className='whitespace-pre-wrap wrap-break-word'>{message.text}</p>
        <div className='mt-0.5 flex items-center justify-end gap-1'>
          <span
            dir='ltr'
            suppressHydrationWarning
            className='shrink-0 text-[11px] leading-none tabular-nums text-gray-500'
          >
            {formatTime(message.timestamp)}
          </span>
          {tick && (
            <span className='inline-flex shrink-0 items-center'>
              <span className='sr-only'>{tick.label}</span>
              <Icon name={tick.icon} className={`size-3.5 ${tick.tone}`} />
            </span>
          )}
        </div>
        {failed && message.failureText && (
          <p className='mt-1 text-[11px] leading-snug text-error-text'>{message.failureText}</p>
        )}
      </div>
    </li>
  )
}

/**
 * Copy is the only action the backend supports for a stored message.
 * Edit/delete contracts do not exist — do not invent them in this sheet.
 */
export function MessageActionSheet({
  text,
  onClose,
}: {
  text: string | null
  onClose: () => void
}) {
  const open = text != null
  return (
    <BottomSheet open={open} onClose={onClose} title='פעולות הודעה' titleId='message-actions'>
      <div className='flex flex-col gap-2'>
        <button
          type='button'
          className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={async () => {
            if (!text) return
            try {
              await navigator.clipboard.writeText(text)
              toast('success', 'ההודעה הועתקה')
            } catch {
              toast('error', 'לא הצלחנו להעתיק את ההודעה')
            }
            onClose()
          }}
        >
          העתק
        </button>
        <button
          type='button'
          className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={onClose}
        >
          ביטול
        </button>
      </div>
    </BottomSheet>
  )
}

export default MessageBubbleMobile
