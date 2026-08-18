'use client'

import Icon from '@/lib/Icon'
import { timeAgo } from '@/components/settings/connections/copy'
import { CATEGORY_ICON } from '@/modules/notifications/dropdown'
import type { NotificationCategory } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'

/**
 * One notification, for a phone.
 *
 * A SEPARATE FILE FROM `NotificationRow`, deliberately. The desktop row is
 * shared by the bell panel and the notification centre and is not being
 * redesigned; forking the LAYOUT while both keep consuming the same
 * `NotificationFeedItem` and the same `onSelect` keeps desktop provably
 * untouched. There is no second data model and no second read.
 *
 * WHAT CHANGED, AND WHY. The desktop row leads with a 16px category glyph that
 * is grey when read and primary when unread, then title, body, time — a dense
 * three-line block sized for a 320px dropdown. On a phone that reads as an admin
 * log: everything the same weight, everything grey.
 *
 * An owner scanning this screen is asking three things in order — who is it,
 * what happened, do I need to move — so the row answers them in that order:
 *
 *   WHO      the title, the only strong text in the row
 *   WHAT     the body, one line, muted
 *   WHEN     relative time, smallest thing on the row
 *   URGENCY  a category-coloured mark, and an unread dot when unread
 *
 * COLOUR ENCODES CATEGORY, NOT DECORATION. Each category gets one semantic tone
 * so a לידים row and a מעקבים row are distinguishable before either is read —
 * which is the entire point of a list you scan rather than study. The tones are
 * existing product semantics (primary, WhatsApp green, warning, error), not new
 * values. A READ row drops to grey: colour marks what still needs attention.
 */

const CATEGORY_TONE: Record<NotificationCategory, { icon: string; ring: string }> = {
  // Lead activity — the product's own primary.
  leads: { icon: 'bg-primary', ring: 'bg-primary-tint' },
  // A customer message. Same green the composer and the lead actions use.
  messages: { icon: 'bg-[#25D366]', ring: 'bg-[#25D366]/10' },
  // Something is due — the existing warning semantic.
  followups: { icon: 'bg-warning-text', ring: 'bg-warning-bg' },
  // A response-time breach — the existing error semantic.
  sla: { icon: 'bg-error-text', ring: 'bg-error-bg' },
  // Plumbing. Genuinely secondary, so genuinely grey.
  integrations: { icon: 'bg-gray-500', ring: 'bg-gray-100' },
}

const READ_TONE = { icon: 'bg-gray-400', ring: 'bg-gray-100' }

export default function NotificationRowMobile({
  item,
  onSelect,
}: {
  item: NotificationFeedItem
  onSelect: (item: NotificationFeedItem) => void
}) {
  const when = timeAgo(item.createdAt)
  const unread = item.readAt === null
  const tone = unread ? (CATEGORY_TONE[item.category] ?? READ_TONE) : READ_TONE

  return (
    <button
      type='button'
      onClick={() => onSelect(item)}
      /* The whole row is the target and it clears 44px on its own — no `tap-44`
         pseudo-element, so nothing can collide with the row above or below. */
      className='press flex w-full items-start gap-3 px-4 py-3 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
    >
      <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${tone.ring}`}>
        <Icon name={CATEGORY_ICON[item.category]} type='sol' className={`size-[18px] ${tone.icon}`} />
      </span>

      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-2'>
          <span className={`truncate text-[15px] leading-tight ${unread ? 'font-bold text-ink' : 'font-medium text-gray-600'}`}>
            {item.title}
          </span>
          {/* The unread mark rides at the end of the name line where the eye
              already is, rather than adding a third column. */}
          {unread && <span aria-hidden className='ms-auto size-2 shrink-0 rounded-full bg-primary' />}
        </span>

        {item.body && (
          <span className='mt-0.5 block truncate text-[13px] leading-snug text-gray-500'>{item.body}</span>
        )}

        {when && <span className='mt-1 block text-[11px] leading-none text-gray-400'>{when}</span>}
      </span>

      {unread && <span className='sr-only'>לא נקרא</span>}
    </button>
  )
}
