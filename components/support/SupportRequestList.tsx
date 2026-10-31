import Link from 'next/link'
import { StatusBadge } from '@/lib/StatusBadge'
import { timeAgoIn } from '@/components/settings/connections/copy'
import type { UiLocale } from '@/lib/i18n/config'
import { customerTextAttrs } from '@/lib/i18n/config'
import type { RequestSummaryView } from '@/lib/support/presenters'

/**
 * The customer's conversations with SocialCRM support.
 *
 * THREE THINGS PER ROW: what they asked about, where it stands, when it last
 * moved. No category, no id, no diagnostics — a row of technical metadata is a
 * helpdesk dashboard, and the presenter does not even carry those fields.
 *
 * Renders NOTHING when the list is empty; the caller decides whether a section
 * appears at all, so an empty box never shows up (ux-guidelines.md §4).
 */
export default function SupportRequestList({ requests, locale = 'he' }: { requests: RequestSummaryView[]; locale?: UiLocale }) {
  if (requests.length === 0) return null

  return (
    <ul className='divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200'>
      {requests.map((r) => (
        <li key={r.id}>
          <Link
            href={`/support/requests/${r.id}`}
            className='flex min-h-12 items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50'
          >
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-medium text-ink' {...customerTextAttrs(locale)}>{r.subject}</span>
              {r.lastActivityAt && (
                <span className='mt-0.5 block text-xs text-gray-400 desktop:hidden'>
                  {timeAgoIn(new Date(r.lastActivityAt).toISOString(), locale)}
                </span>
              )}
            </span>
            <StatusBadge role={r.statusRole} label={r.statusLabel} />
            <span className='hidden shrink-0 text-xs text-gray-400 desktop:inline'>
              {r.lastActivityAt ? timeAgoIn(new Date(r.lastActivityAt).toISOString(), locale) : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
