import Link from 'next/link'
import { StatusBadge } from '@/lib/StatusBadge'
import { timeAgo } from '@/components/settings/connections/copy'
import { CATEGORY_COPY } from '@/lib/support/copy'
import { ADMIN_STATUS_COPY } from '@/lib/support/adminCopy'
import type { AdminSupportRow } from '@/db/support/admin'

function relative(at: Date | string | null): string {
  if (!at) return '—'
  return timeAgo(new Date(at).toISOString()) ?? '—'
}

/**
 * The owner inbox list — scan, don't triage.
 *
 * Ordered by recency. The requests waiting on US are the ones whose last
 * message came from the customer; those get a clear "חדש / ממתין לתשובה"
 * marker rather than a priority system. Markup mirrors app/admin/page.tsx.
 */
export default function AdminSupportTable({ rows }: { rows: AdminSupportRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-14 text-center'>
        <p className='text-base font-semibold text-gray-900'>אין פניות שמחכות לכם</p>
        <p className='mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500'>
          כשלקוח יפנה דרך מרכז התמיכה, הפנייה תופיע כאן.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Mobile: stacked cards for fast thumb scanning at ~390px. */}
      <ul className='space-y-3 desktop:hidden'>
        {rows.map((r) => {
          const status = ADMIN_STATUS_COPY[r.status]
          const awaitingUs = r.lastMessageAuthorKind === 'customer' && r.status !== 'resolved'
          const isNew = r.status === 'open' && awaitingUs
          return (
            <li key={r.id}>
              <Link
                href={`/admin/support/${r.id}`}
                className={`block rounded-2xl border bg-white p-4 transition hover:bg-gray-50 ${
                  awaitingUs ? 'border-amber-200' : 'border-gray-200'
                }`}
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0 flex-1'>
                    <span className='block text-sm font-semibold leading-snug text-gray-900'>
                      {r.subject}
                    </span>
                    <span className='mt-0.5 block text-xs text-gray-400'>{CATEGORY_COPY[r.category]}</span>
                  </div>
                  <StatusBadge role={status.role} label={isNew ? 'חדש' : status.label} />
                </div>
                <p className='mt-2 text-xs text-gray-500'>
                  {r.agencyName ?? `Agency ${r.agencyId}`}
                  {' · '}
                  {relative(r.lastMessageAt)}
                </p>
                {awaitingUs && !isNew && (
                  <p className='mt-1.5 text-xs font-semibold text-amber-700'>ממתין לתשובה שלנו</p>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Desktop: the admin table language. */}
      <div className='hidden overflow-hidden rounded-2xl border border-gray-200 bg-white desktop:block'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-gray-100 bg-gray-50 text-right'>
              <Th>נושא</Th>
              <Th>חשבון</Th>
              <Th>פונה</Th>
              <Th>סטטוס</Th>
              <Th>פעילות</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = ADMIN_STATUS_COPY[r.status]
              const awaitingUs = r.lastMessageAuthorKind === 'customer' && r.status !== 'resolved'
              const isNew = r.status === 'open' && awaitingUs
              return (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 hover:bg-gray-50 ${
                    awaitingUs ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <td className='px-4 py-3'>
                    <Link
                      href={`/admin/support/${r.id}`}
                      className='font-semibold text-gray-900 hover:underline'
                    >
                      {r.subject}
                    </Link>
                    <span className='mt-0.5 block text-xs text-gray-400'>{CATEGORY_COPY[r.category]}</span>
                    {awaitingUs && (
                      <span className='mt-0.5 block text-xs font-semibold text-amber-700'>
                        {isNew ? 'חדש · ממתין לתשובה' : 'ממתין לתשובה שלנו'}
                      </span>
                    )}
                  </td>
                  <td className='px-4 py-3 text-gray-700'>
                    {r.agencyName ?? `Agency ${r.agencyId}`}
                  </td>
                  <td className='px-4 py-3 text-gray-500'>
                    <span className='block text-gray-900'>{r.requesterNameSnapshot || '—'}</span>
                    <span className='block text-xs'>{r.requesterEmailSnapshot || '—'}</span>
                  </td>
                  <td className='px-4 py-3'>
                    <StatusBadge role={status.role} label={isNew ? 'חדש' : status.label} />
                  </td>
                  <td className='px-4 py-3 text-gray-500'>{relative(r.lastMessageAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className='px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400'>
      {children}
    </th>
  )
}
