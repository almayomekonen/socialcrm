'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import useLongPress from '@/components/mobile/useLongPress'
import type { ConversationListRow } from './conversationSelection'

/**
 * One conversation row. The whole row is the target — no nested buttons.
 *
 * Normal: Link to the thread. Long press enters selection (never deletes).
 * Selection: the same row toggles membership by id.
 *
 * The active search rides along in the thread URL. Without it, opening a
 * conversation from a filtered list dropped `q`, so the thread's back link had
 * nothing to return to and the rep landed on the unfiltered list — having to
 * retype the search they were already working in.
 */
export default function ConversationRowMobile({
  item,
  q = '',
  selecting,
  selected,
  onToggle,
  onEnterSelection,
}: {
  item: ConversationListRow
  /** Active search, preserved so returning from the thread keeps the list. */
  q?: string
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onEnterSelection: () => void
}) {
  const name = item.displayName || item.leadName || 'שיחה'
  const preview = item.lastMessagePreview?.trim() || (item.lastMessageAt ? '' : 'אין הודעות עדיין')
  const longPress = useLongPress(onEnterSelection, !selecting)

  const cls = `flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
    selected ? 'bg-primary-tint' : item.unread ? 'bg-primary-tint/40' : 'bg-white active:bg-gray-100'
  } ${selecting ? '' : 'hover:bg-gray-50'}`

  const inner = (
    <>
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          selected ? 'bg-primary text-white' : 'bg-[#25D366]/10'
        }`}
      >
        {selected ? (
          <Icon name='check' type='sol' className='size-5 bg-white' />
        ) : (
          <Icon name='whatsapp' type='sol' className='size-5 bg-[#25D366]' />
        )}
      </span>

      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline gap-2'>
          <span className={`truncate text-[15px] leading-tight text-ink ${item.unread ? 'font-bold' : 'font-semibold'}`}>
            {name}
          </span>
          <span className='ms-auto shrink-0 text-[11px] tabular-nums leading-tight text-gray-400'>{item.when}</span>
        </span>
        <span className='mt-0.5 flex items-center gap-2'>
          <span className={`truncate text-[13px] leading-tight ${item.unread ? 'text-gray-700' : 'text-gray-500'}`}>
            {item.lastDirection === 'outbound' && preview ? 'את/ה: ' : ''}
            {preview}
          </span>
          {item.unread && !selected && (
            <span aria-hidden className='ms-auto size-2.5 shrink-0 rounded-full bg-primary' />
          )}
        </span>
        {item.waitingTitle && (
          <span className='mt-0.5 block truncate text-[12px] font-medium leading-tight text-amber-800'>
            {item.waitingTitle}
          </span>
        )}
        {item.waitingWindowHint && (
          <span className='block truncate text-[12px] leading-tight text-gray-500'>{item.waitingWindowHint}</span>
        )}
      </span>
    </>
  )

  return (
    <li>
      <Link
        href={`/inbox?conversation=${item.conversationId}${q ? `&q=${encodeURIComponent(q)}` : ''}` as Route}
        prefetch={false}
        data-testid='conversation-row'
        data-conversation-id={item.conversationId}
        aria-pressed={selecting ? selected : undefined}
        className={cls}
        {...longPress}
        onClick={
          selecting
            ? (e) => {
                e.preventDefault()
                onToggle()
              }
            : undefined
        }
      >
        {inner}
      </Link>
    </li>
  )
}
