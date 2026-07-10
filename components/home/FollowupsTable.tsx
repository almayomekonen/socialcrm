'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import LeadQuickActions from './LeadQuickActions'
import type { DueWorklistRow } from '@/db/worklist'
import type { Urgency } from '@/lib/time/businessDay'

// Presentational only. Urgency is classified on the SERVER (DashboardPage) against
// the business day and passed in as a prop — this component performs NO
// time-relative computation, which is what previously caused the hydration
// mismatch (React #418) between the UTC server and the Asia/Jerusalem browser.
export type FollowupRow = DueWorklistRow & { urgency: Urgency }

const PAGE_SIZE = 8

export default function FollowupsTable({ rows, total }: { rows: FollowupRow[]; total: number }) {
  const [page, setPage] = useState(0)

  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [rows])

  const visible = rows.filter((r) => !completedIds.has(r.id))
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className='rounded-lg border border-gray-200 bg-white'>
      <div className='flex items-baseline justify-between px-4 pt-3'>
        <h2 className='text-sm font-medium text-gray-700'>מעקבים</h2>
        <span className='text-xs text-gray-400 tabular-nums'>{total} בהמשך</span>
      </div>

      {visible.length === 0 ? (
        <p className='px-4 py-8 text-center text-sm text-gray-400'>אין מעקבים נוספים כרגע</p>
      ) : (
        <ul className='mt-1 h-88 divide-y divide-gray-50 overflow-y-auto'>
          {slice.map((row) => {
            const u = row.urgency
            return (
              <li key={row.id} className='flex items-center justify-between gap-3 px-4 py-2'>
                <div className='min-w-0 flex items-baseline gap-2'>
                  <Link href={`/clients/${row.id}/summary`} className='text-sm text-gray-800 truncate hover:underline'>
                    {row.name || '—'}
                  </Link>
                  <span className={`text-xs shrink-0 ${u.tone}`}>{u.label}</span>
                  {row.followUpNote && <span className='text-xs text-gray-400 truncate'>· {row.followUpNote}</span>}
                </div>
                <LeadQuickActions
                  id={row.id}
                  phone={row.phone}
                  status={row.status}
                  nextFollowUpAt={row.nextFollowUpAt}
                  quiet
                  onCompleted={() => setCompletedIds((s) => new Set(s).add(row.id))}
                />
              </li>
            )
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <div className='flex items-center justify-between border-t border-gray-100 px-4 py-2 text-sm'>
          <button
            type='button'
            onClick={() => setPage(Math.max(0, current - 1))}
            disabled={current === 0}
            className='rounded-md px-3 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40'
          >
            הקודם
          </button>
          <span className='text-xs text-gray-400 tabular-nums'>
            עמוד {current + 1} מתוך {pageCount}
          </span>
          <button
            type='button'
            onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
            disabled={current >= pageCount - 1}
            className='rounded-md px-3 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40'
          >
            הבא
          </button>
        </div>
      )}
    </div>
  )
}
