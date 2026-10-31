'use client'

import Icon from '@/lib/Icon'
import { timeAgoIn } from '@/components/settings/connections/copy'
import { CATEGORY_ICON } from '@/modules/notifications/dropdown'
import { storedTextIn } from '@/modules/notifications/display'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import type { NotificationFeedItem } from '@/modules/notifications/types'

/**
 * One notification, as a clickable row. Shared by the bell's panel (P2.3) and the
 * notification center (P2.4).
 *
 * It lives in its own file for the reason the center exists at all: the two
 * surfaces show the SAME database records, and a row rendered twice from two
 * copies of this markup would drift — different unread affordance in the panel
 * than on the page, for the same notification. Extracted with no behavioural
 * change; the P2.3 panel tests pin that.
 *
 * A row is a single `<button>`, so it has exactly one action: mark read, then go
 * to the entity. No nested controls, which keeps it one tab stop and one
 * announcement.
 *
 * Title and body are the stored text in Hebrew; in another language they are
 * re-worded when provably exact (`storedTextIn`), otherwise shown as stored
 * inside a declared Hebrew region.
 */
export default function NotificationRow({
  item,
  onSelect,
}: {
  item: NotificationFeedItem
  onSelect: (item: NotificationFeedItem) => void
}) {
  const t = useT()
  const title = storedTextIn(item, 'title', t.locale)!
  const body = storedTextIn(item, 'body', t.locale)
  const when = timeAgoIn(item.createdAt, t.locale)
  const unread = item.readAt === null

  return (
    <button
      type='button'
      onClick={() => onSelect(item)}
      className='flex w-full items-start gap-2.5 px-3 py-2.5 text-start hover:bg-gray-50 focus:outline-none focus:bg-gray-50 focus:ring-2 focus:ring-inset focus:ring-primary'
    >
      <span className='mt-0.5 shrink-0'>
        <Icon name={CATEGORY_ICON[item.category]} type='sol' className={`size-4 ${unread ? 'bg-primary' : 'bg-gray-400'}`} />
      </span>
      <span className='min-w-0 flex-1'>
        <span
          className={`block truncate text-sm ${unread ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
          {...(title.verbatim ? untranslatedAttrs(t.locale) : {})}
        >
          {title.text}
        </span>
        {body && (
          <span className='mt-0.5 block text-xs leading-snug text-gray-500' {...(body.verbatim ? untranslatedAttrs(t.locale) : {})}>
            {body.text}
          </span>
        )}
        {when && <span className='mt-0.5 block text-[11px] text-gray-400'>{when}</span>}
      </span>
      {/* Unread marker. aria-hidden because the row's own text weight is not the
          accessible signal either — the state is announced by the word below. */}
      {unread && (
        <>
          <span aria-hidden className='mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500' />
          <span className='sr-only'>{t('inbox.row.unread')}</span>
        </>
      )}
    </button>
  )
}
