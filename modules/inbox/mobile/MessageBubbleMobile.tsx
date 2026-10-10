'use client'

import BottomSheet from '@/components/mobile/BottomSheet'
import Icon, { type IconNames } from '@/lib/Icon'
import WhatsappAttachment from '@/components/summary/WhatsappAttachment'
import { bubbleMediaLayout, messageBody, type ThreadQuote, type ThreadReaction } from '@/lib/inbox/whatsappThreadView'
import WhatsappQuoteStrip from '@/components/summary/WhatsappQuoteStrip'
import { WhatsappReactionChips } from '@/components/summary/WhatsappReactions'
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
  reactions = [],
  quote = null,
}: {
  message: LeadWhatsappMessage
  onOpen: () => void
  /** Reactions on this message (lib/inbox/whatsappThreadView.ts). */
  reactions?: ThreadReaction[]
  /** What this reply quotes, when it is a reply. */
  quote?: ThreadQuote | null
}) {
  const outbound = message.direction === 'outbound'
  const longPress = useLongPress(onOpen, Boolean(message.text?.trim()))
  const tick = outbound ? TICK[message.status] : undefined
  const failed = outbound && message.status === 'failed'
  /**
   * An unsupported type must never render as an empty bubble — that is exactly
   * what made a received PDF look like nothing had arrived.
   */
  const body = messageBody(message) ?? ''
  const { photoBubble, mediaCarriesTime } = bubbleMediaLayout(message)

  return (
    <li className={`flex flex-col gap-1 ${outbound ? 'items-start' : 'items-end'}`}>
      <div
        data-testid='message-bubble'
        data-direction={message.direction}
        className={`max-w-[80%] break-words rounded-2xl text-[15px] leading-relaxed text-ink select-none [-webkit-touch-callout:none] ${
          photoBubble ? 'overflow-hidden p-1' : 'px-3 py-1.5'
        } ${
          failed
            ? 'rounded-es-sm border border-error-border bg-error-bg'
            : outbound
              ? 'rounded-es-sm bg-[#d9fdd3]'
              : 'rounded-ee-sm bg-white shadow-sm'
        }`}
        {...longPress}
      >
        <span className='sr-only'>{outbound ? 'הודעה שנשלחה מהמערכת' : 'הודעה נכנסת'}</span>
        {quote && <WhatsappQuoteStrip quote={quote} />}
        {message.attachment && (
          <WhatsappAttachment
            messageId={message.id}
            attachment={message.attachment}
            timestampLabel={formatTime(message.timestamp)}
          />
        )}
        {body && <p className='whitespace-pre-wrap wrap-break-word'>{body}</p>}
        <div className={`flex items-center justify-end gap-1 ${mediaCarriesTime ? '' : 'mt-0.5'}`}>
          {/* The photo and the voice note already show the time, so repeating it
              under the bubble would render it twice. */}
          {!mediaCarriesTime && (
            <span
              dir='ltr'
              suppressHydrationWarning
              className='shrink-0 text-[11px] leading-none tabular-nums text-gray-500'
            >
              {formatTime(message.timestamp)}
            </span>
          )}
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
      <WhatsappReactionChips reactions={reactions} alignEnd={!outbound} />
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
