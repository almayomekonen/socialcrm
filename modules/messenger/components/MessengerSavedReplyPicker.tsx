'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import { customerTextAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Pick a saved reply from the composer.
 *
 * TWO DIFFERENT ACTIONS, deliberately distinguished:
 *  · a plain-text snippet is INSERTED into the composer, so the rep edits it
 *    before sending — which is the point of a starting point;
 *  · a reply carrying buttons, quick replies or an attachment is SENT as-is,
 *    because those cannot be represented in a textarea and editing them there
 *    would silently drop them.
 * The list says which is which, so nothing happens that the rep did not expect.
 *
 * Keyboard: ↑/↓ move, Enter chooses, Escape closes and returns focus to the
 * trigger. It is a `listbox`, not a menu of buttons, so assistive tech announces
 * position and count.
 */
export default function MessengerSavedReplyPicker({
  replies,
  onInsert,
  onSend,
  disabled,
  locale = 'he',
}: {
  replies: MessengerSavedReply[]
  onInsert: (reply: MessengerSavedReply) => void
  onSend: (reply: MessengerSavedReply) => void
  disabled?: boolean
  /** Our labels only; a reply's title and body are the agency's own text. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || trigger.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (replies.length === 0) return null

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const choose = (reply: MessengerSavedReply) => {
    // Structure cannot survive a textarea, so it is sent rather than inserted.
    const structured = reply.buttons.length > 0 || reply.quickReplies.length > 0 || !!reply.attachmentUrl
    if (structured) onSend(reply)
    else onInsert(reply)
    close()
  }

  return (
    <div className='relative'>
      <button
        ref={trigger}
        type='button'
        onClick={() => {
          setActive(0)
          setOpen((v) => !v)
        }}
        disabled={disabled}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-label={t('inbox.messenger.saved.label')}
        title={t('inbox.messenger.saved.label')}
        className='flex size-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50'
      >
        <MessageSquareText aria-hidden className='size-4' />
      </button>

      {open && (
        <div
          ref={panel}
          role='listbox'
          aria-label={t('inbox.messenger.saved.label')}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => (i + 1) % replies.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => (i - 1 + replies.length) % replies.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(replies[active])
            }
          }}
          // Opens upward: the composer sits at the bottom of the thread.
          className='absolute bottom-11 start-0 z-20 max-h-64 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg'
        >
          {replies.map((reply, i) => {
            const structured = reply.buttons.length > 0 || reply.quickReplies.length > 0 || !!reply.attachmentUrl
            return (
              <button
                key={reply.id}
                type='button'
                role='option'
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(reply)}
                className={`block w-full rounded-md px-2.5 py-1.5 text-start transition-colors ${
                  i === active ? 'bg-primary-soft' : 'hover:bg-gray-50'
                }`}
              >
                <span className='block truncate text-sm font-medium text-gray-900' {...customerTextAttrs(locale)}>
                  {reply.title}
                </span>
                {reply.body && (
                  <span className='mt-0.5 block truncate text-xs text-gray-500' {...customerTextAttrs(locale)}>
                    {reply.body}
                  </span>
                )}
                <span className='mt-0.5 block text-[10px] text-gray-400'>
                  {structured ? t('inbox.messenger.saved.sendsNow') : t('inbox.messenger.saved.inserts')}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
