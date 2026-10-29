'use client'

import { Trash2 } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'

/** The saved replies, one row each with edit and delete (split from MessengerSavedReplies). */
export default function SavedReplyList({
  replies,
  loading,
  onEdit,
  onRemove,
}: {
  replies: MessengerSavedReply[]
  loading: boolean
  onEdit: (reply: MessengerSavedReply) => void
  onRemove: (reply: MessengerSavedReply) => void
}) {
  return (
    <ul className='grid gap-1.5'>
      {replies.map((reply) => (
        <li
          key={reply.id}
          className='flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2'
        >
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-medium text-gray-900'>{reply.title}</p>
            {reply.body && <p className='mt-0.5 truncate text-xs text-gray-500'>{reply.body}</p>}
            {(reply.quickReplies.length > 0 || reply.buttons.length > 0 || reply.attachmentUrl) && (
              <p className='mt-0.5 text-[11px] text-gray-400'>
                {[
                  reply.quickReplies.length > 0 ? `${reply.quickReplies.length} תשובות מהירות` : null,
                  reply.buttons.length > 0 ? `${reply.buttons.length} כפתורים` : null,
                  reply.attachmentUrl ? 'קובץ מצורף' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          <Btn
            variant='outline'
            size='small'
            lbl='ערוך'
            aria-label={`ערוך את ${reply.title}`}
            onClick={() => onEdit(reply)}
            disabled={loading}
          />
          <button
            type='button'
            onClick={() => onRemove(reply)}
            disabled={loading}
            aria-label={`מחק את ${reply.title}`}
            title={`מחק את ${reply.title}`}
            className='flex size-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40'
          >
            <Trash2 aria-hidden className='size-3.5' />
          </button>
        </li>
      ))}
    </ul>
  )
}
