'use client'

import type { RefObject } from 'react'
import Icon from '@/lib/Icon'
import { timeAgo } from '@/components/settings/connections/copy'
import { CATEGORY_ICON, CATEGORY_LABEL, hasMeaningfulAway } from '@/modules/notifications/dropdown'
import type { NotificationFeedItem, WhileYouWereAway } from '@/modules/notifications/types'
import type { MenuPos } from '@/lib/useFloatingMenu'

/**
 * The notification panel. Presentation only — every fact it renders arrived from
 * the feed, and every action it offers is a callback into NotificationContext.
 *
 * STRUCTURE (spec §13):
 *   [While you were away — only when there is something to say]
 *   [Recent notifications, newest first, one row per database record]
 *
 * Individual rows, never grouped: collapse already happened in the database
 * (`groupCount`), and re-grouping here would invent a second, disagreeing view of
 * the same data. Delivery-channel grouping is a P4 concern.
 *
 * It is a floating anchored surface using the app's existing `useFloatingMenu`
 * mechanics — the same ones `OutcomeControl` uses — not a modal and not a page.
 * Escape closes it and light-dismiss closes it; neither is re-implemented here.
 */

const HEADING_ID = 'notifPanelTitle'

export default function NotificationPanel({
  containerRef,
  pos,
  items,
  whileYouWereAway,
  unreadCount,
  onSelect,
  onMarkAllRead,
  onClose,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  pos: MenuPos
  items: NotificationFeedItem[]
  whileYouWereAway: WhileYouWereAway | null
  unreadCount: number
  onSelect: (item: NotificationFeedItem) => void
  onMarkAllRead: () => void
  onClose: () => void
}) {
  const away = hasMeaningfulAway(whileYouWereAway) ? whileYouWereAway : null

  return (
    <div
      ref={containerRef}
      /**
       * Focusable container, not a dialog: the panel does not trap focus or block
       * the page, so announcing it as a modal would promise behavior it correctly
       * does not have. `tabIndex={-1}` exists so the bell can move focus here on
       * open — required because the panel is portaled and would otherwise sit
       * outside the tab order.
       */
      tabIndex={-1}
      aria-labelledby={HEADING_ID}
      onKeyDown={(e) => {
        // Escape also reaches useFloatingMenu's document listener; closing twice is
        // idempotent, and going through onClose is what returns focus to the bell.
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 100000 }}
      className='flex flex-col rounded-lg border border-gray-200 bg-white shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)] focus:outline-none'
    >
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <h2 id={HEADING_ID} className='text-sm font-semibold text-gray-900'>
          התראות
        </h2>
        {unreadCount > 0 && (
          <button
            type='button'
            onClick={onMarkAllRead}
            className='rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary'
          >
            סימון הכל כנקרא
          </button>
        )}
      </div>

      {away && <AwaySummary away={away} />}

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className='max-h-80 divide-y overflow-y-auto'>
          {items.map((item) => (
            <li key={item.id}>
              <NotificationRow item={item} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * "While you were away" — the persisted summary from `awaySinceAt` (P2.1),
 * rendered as a calm band inside the panel.
 *
 * Never a modal or a takeover: someone returning to their desk gets a sentence
 * they can ignore, not a screen they must dismiss. It is also not recomputed
 * here — the totals are the server's.
 */
function AwaySummary({ away }: { away: WhileYouWereAway }) {
  const since = timeAgo(away.since)
  return (
    <section aria-label='בזמן שלא היית' className='border-b bg-gray-50 px-3 py-2'>
      <p className='text-xs font-semibold text-gray-700'>
        בזמן שלא היית{since ? ` · ${since}` : ''}
      </p>
      <p className='mt-0.5 text-xs text-gray-500'>
        {away.total === 1 ? 'התראה אחת חדשה' : `${away.total} התראות חדשות`}
        {' · '}
        {away.categories.map((c) => `${CATEGORY_LABEL[c.category]} ${c.count}`).join(', ')}
      </p>
    </section>
  )
}

function NotificationRow({
  item,
  onSelect,
}: {
  item: NotificationFeedItem
  onSelect: (item: NotificationFeedItem) => void
}) {
  const when = timeAgo(item.createdAt)
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
        <span className={`block truncate text-sm ${unread ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
          {item.title}
        </span>
        {item.body && <span className='mt-0.5 block text-xs leading-snug text-gray-500'>{item.body}</span>}
        {when && <span className='mt-0.5 block text-[11px] text-gray-400'>{when}</span>}
      </span>
      {/* Unread marker. aria-hidden because the row's own text weight is not the
          accessible signal either — the state is announced by the word below. */}
      {unread && (
        <>
          <span aria-hidden className='mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500' />
          <span className='sr-only'>לא נקרא</span>
        </>
      )}
    </button>
  )
}

/**
 * The calm empty state (ux-guidelines §4): what, why, and what happens next.
 * Compact, because this is a dropdown — a full-height empty panel would make
 * "nothing needs you" feel like a malfunction.
 */
function EmptyState() {
  return (
    <div className='px-4 py-8 text-center'>
      <p className='text-sm text-gray-700'>אין התראות חדשות</p>
      <p className='mt-1 text-xs leading-relaxed text-gray-500'>
        כשליד חדש ייכנס או כשמשהו ידרוש טיפול, זה יופיע כאן.
      </p>
    </div>
  )
}
