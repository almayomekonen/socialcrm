import Link from 'next/link'
import type { CommentStatusFilter } from '../types'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Status filter for the Comments Inbox — the WhatsApp inbox's status vocabulary
 * ("הכל" first and default) in the chip style of `InboxChannelSwitch` /
 * `NotificationFilters`, kept in the URL (`?status=`) so it survives refresh,
 * Back and a shared link.
 *
 * "הכל" is the default so a comment turned into a ליד stays where the user left
 * it, with its "פתח ליד" link. Links, not buttons: this is navigation.
 */
const OPTIONS: { value: CommentStatusFilter; label: MessageKey; href: string }[] = [
  { value: 'all', label: 'inbox.comments.filter.all', href: '/inbox/comments' },
  { value: 'open', label: 'inbox.comments.filter.open', href: '/inbox/comments?status=open' },
  { value: 'converted', label: 'inbox.comments.filter.converted', href: '/inbox/comments?status=converted' },
]

/** The only `?status=` values the Comments Inbox page accepts. */
export const PAGE_STATUS_FILTERS: readonly CommentStatusFilter[] = OPTIONS.map((o) => o.value)

export default function CommentsStatusFilter({
  active,
  openCount = null,
  locale = 'he',
}: {
  active: CommentStatusFilter
  /** Server-counted open comments (countOpenComments); null hides the badge. */
  openCount?: number | null
  /** Labels only — the filter values in the URL never change. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <nav aria-label={t('inbox.comments.filter.label')} className='flex flex-wrap items-center gap-1.5'>
      {OPTIONS.map((o) => {
        const isActive = o.value === active
        const count = o.value === 'open' && openCount ? openCount : null
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? 'border-info-border bg-primary-tint text-primary-text font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {t(o.label)}
            {count !== null && (
              <span className='rounded-full bg-white px-1.5 text-[10px] font-semibold tabular-nums text-primary-text'>
                <span className='sr-only'>, </span>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
