import Link from 'next/link'
import { StatusBadge } from '@/lib/StatusBadge'
import { timeAgo } from '@/components/settings/connections/copy'
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
export default function SupportRequestList({ requests }: { requests: RequestSummaryView[] }) {
  if (requests.length === 0) return null

  return (
    <ul className='divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200'>
      {requests.map((r) => (
        <li key={r.id}>
          <Link
            href={`/support/requests/${r.id}`}
            className='flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50'
          >
            <span className='min-w-0 flex-1 truncate text-sm font-medium text-ink'>{r.subject}</span>
            <StatusBadge role={r.statusRole} label={r.statusLabel} />
            <span className='hidden shrink-0 text-xs text-gray-400 desktop:inline'>
              {r.lastActivityAt ? timeAgo(new Date(r.lastActivityAt).toISOString()) : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
