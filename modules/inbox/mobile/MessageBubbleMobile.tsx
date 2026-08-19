'use client'

import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import useLongPress from '@/components/mobile/useLongPress'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'

export function MessageBubbleMobile({
  message,
  onOpen,
}: {
  message: LeadWhatsappMessage
  onOpen: () => void
}) {
  const outbound = message.direction === 'outbound'
  const longPress = useLongPress(onOpen, Boolean(message.text?.trim()))

  return (
    <li className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
      <div
        data-testid='message-bubble'
        className={`max-w-[80%] break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed select-none [-webkit-touch-callout:none] ${
          outbound ? 'rounded-es-sm bg-primary-tint text-ink' : 'rounded-ee-sm bg-white text-ink shadow-sm'
        }`}
        {...longPress}
      >
        {message.text}
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
