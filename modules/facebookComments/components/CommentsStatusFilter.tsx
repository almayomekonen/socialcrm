import Link from 'next/link'
import type { CommentStatusFilter } from '../types'

/**
 * Status filter for the Comments Inbox — the WhatsApp inbox's status vocabulary
 * ("הכל" first and default) in the chip style of `InboxChannelSwitch` /
 * `NotificationFilters`, kept in the URL (`?status=`) so it survives refresh,
 * Back and a shared link.
 *
 * "הכל" is the default so a comment turned into a ליד stays where the user left
 * it, with its "פתח ליד" link. Links, not buttons: this is navigation.
 */
const OPTIONS: { value: CommentStatusFilter; label: string; href: string }[] = [
  { value: 'all', label: 'הכל', href: '/inbox/comments' },
  { value: 'open', label: 'פתוחות', href: '/inbox/comments?status=open' },
  { value: 'converted', label: 'הומרו לליד', href: '/inbox/comments?status=converted' },
]

/** The only `?status=` values the Comments Inbox page accepts. */
export const PAGE_STATUS_FILTERS: readonly CommentStatusFilter[] = OPTIONS.map((o) => o.value)

export default function CommentsStatusFilter({ active }: { active: CommentStatusFilter }) {
  return (
    <nav aria-label='סינון תגובות' className='flex flex-wrap items-center gap-1.5'>
      {OPTIONS.map((o) => {
        const isActive = o.value === active
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? 'border-info-border bg-primary-tint text-primary-text font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </nav>
  )
}
