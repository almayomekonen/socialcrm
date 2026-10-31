'use client'

import Icon from '@/lib/Icon'
import { timeAgoIn } from '@/components/settings/connections/copy'
import { CATEGORY_ICON } from '@/modules/notifications/dropdown'
import { categoryLabelIn, storedTextIn } from '@/modules/notifications/display'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import type { NotificationCategory } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'
import useLongPress from '@/components/mobile/useLongPress'

/**
 * One notification, for a phone.
 *
 * A SEPARATE FILE FROM `NotificationRow`, deliberately. Desktop is untouched.
 * Long press enters selection; a normal tap still opens the entity.
 *
 * Visual language matches mobile Leads / Integrations: a structured CRM row
 * (rectangular icon well, type hierarchy, small unread dot) — not a chat
 * bubble or a coloured capsule.
 */

const CATEGORY_ICON_TONE: Record<NotificationCategory, string> = {
  leads: 'bg-primary',
  messages: 'bg-[#25D366]',
  followups: 'bg-warning-text',
  sla: 'bg-error-text',
  integrations: 'bg-gray-500',
}

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
  const t = useT()
  const title = storedTextIn(item, 'title', t.locale)!
  const body = storedTextIn(item, 'body', t.locale)
  const when = timeAgoIn(item.createdAt, t.locale)
  const unread = item.readAt === null
  const iconTone = unread ? (CATEGORY_ICON_TONE[item.category] ?? 'bg-gray-400') : 'bg-gray-400'
  const longPress = useLongPress(onEnterSelection ?? (() => {}), Boolean(onEnterSelection) && !selecting)
  const source = categoryLabelIn(item.category, t.locale)
  const meta = [when, source].filter(Boolean).join(' · ')

  const markCls = `mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md ${
    selecting && selected ? 'bg-primary' : 'border border-gray-200 bg-gray-50'
  }`

  const inner = (
    <>
      <span className={markCls}>
        {selecting && selected ? (
          <Icon name='check' type='sol' className='size-[18px] bg-white' />
        ) : (
          <Icon name={CATEGORY_ICON[item.category]} type='sol' className={`size-[18px] ${iconTone}`} />
        )}
      </span>

      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-2'>
          <span
            className={`truncate text-[15px] leading-tight ${unread ? 'font-semibold text-ink' : 'font-medium text-gray-600'}`}
            {...(title.verbatim ? untranslatedAttrs(t.locale) : {})}
          >
            {title.text}
          </span>
          {unread && !selected && <span aria-hidden className='ms-auto size-1.5 shrink-0 rounded-full bg-primary' />}
        </span>

        {body && (
          <span
            className='mt-0.5 block truncate text-[13px] leading-snug text-gray-500'
            {...(body.verbatim ? untranslatedAttrs(t.locale) : {})}
          >
            {body.text}
          </span>
        )}

        {meta && <span className='mt-1 block text-[11px] leading-none text-gray-400'>{meta}</span>}
      </span>

      {unread && <span className='sr-only'>{t('inbox.row.unread')}</span>}
    </>
  )

  const cls = `press flex min-h-11 w-full items-start gap-3 px-3.5 py-2.5 text-start select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
    selected ? 'bg-primary-tint' : unread ? 'border-s-2 border-s-primary' : ''
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
