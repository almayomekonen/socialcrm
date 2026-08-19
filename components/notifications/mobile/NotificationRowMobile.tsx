'use client'

import Icon from '@/lib/Icon'
import { timeAgo } from '@/components/settings/connections/copy'
import { CATEGORY_ICON } from '@/modules/notifications/dropdown'
import type { NotificationCategory } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'
import useLongPress from '@/components/mobile/useLongPress'

/**
 * One notification, for a phone.
 *
 * A SEPARATE FILE FROM `NotificationRow`, deliberately. Desktop is untouched.
 * Long press enters selection; a normal tap still opens the entity.
 */

const CATEGORY_TONE: Record<NotificationCategory, { icon: string; ring: string }> = {
  leads: { icon: 'bg-primary', ring: 'bg-primary-tint' },
  messages: { icon: 'bg-[#25D366]', ring: 'bg-[#25D366]/10' },
  followups: { icon: 'bg-warning-text', ring: 'bg-warning-bg' },
  sla: { icon: 'bg-error-text', ring: 'bg-error-bg' },
  integrations: { icon: 'bg-gray-500', ring: 'bg-gray-100' },
}

const READ_TONE = { icon: 'bg-gray-400', ring: 'bg-gray-100' }

export default function NotificationRowMobile({
  item,
  onSelect,
  selecting = false,
  selected = false,
  onToggle,
  onEnterSelection,
}: {
  item: NotificationFeedItem
  onSelect: (item: NotificationFeedItem) => void
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
  onEnterSelection?: () => void
}) {
  const when = timeAgo(item.createdAt)
  const unread = item.readAt === null
  const tone = unread ? (CATEGORY_TONE[item.category] ?? READ_TONE) : READ_TONE
  const longPress = useLongPress(onEnterSelection ?? (() => {}), Boolean(onEnterSelection) && !selecting)

  const inner = (
    <>
      {selecting ? (
        <span
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
            selected ? 'bg-primary text-white' : tone.ring
          }`}
        >
          {selected ? (
            <Icon name='check' type='sol' className='size-[18px] bg-white' />
          ) : (
            <Icon name={CATEGORY_ICON[item.category]} type='sol' className={`size-[18px] ${tone.icon}`} />
          )}
        </span>
      ) : (
        <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${tone.ring}`}>
          <Icon name={CATEGORY_ICON[item.category]} type='sol' className={`size-[18px] ${tone.icon}`} />
        </span>
      )}

      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-2'>
          <span className={`truncate text-[15px] leading-tight ${unread ? 'font-bold text-ink' : 'font-medium text-gray-600'}`}>
            {item.title}
          </span>
          {unread && !selected && <span aria-hidden className='ms-auto size-2 shrink-0 rounded-full bg-primary' />}
        </span>

        {item.body && (
          <span className='mt-0.5 block truncate text-[13px] leading-snug text-gray-500'>{item.body}</span>
        )}

        {when && <span className='mt-1 block text-[11px] leading-none text-gray-400'>{when}</span>}
      </span>

      {unread && <span className='sr-only'>לא נקרא</span>}
    </>
  )

  const cls = `press flex w-full items-start gap-3 px-4 py-3 text-start select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
    selected ? 'bg-primary-tint' : ''
  }`

  return (
    <button
      type='button'
      data-testid='notification-row'
      data-notification-id={item.id}
      aria-pressed={selecting ? selected : undefined}
      onClick={selecting ? onToggle : () => onSelect(item)}
      className={cls}
      {...longPress}
    >
      {inner}
    </button>
  )
}
