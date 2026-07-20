'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import LeadQuickActions from './LeadQuickActions'
import type { DueWorklistRow } from '@/db/worklist'

const PAGE_SIZE = 8

// Per-row presentation, computed SERVER-SIDE and passed in (label/tone/dot from
// urgencyOfRow, waiting string). Keeps all time logic off the client — no
// startOfToday() here, no hydration mismatch.
export type RowMeta = { label: string; tone: string; dot: string; waiting: string | null }

const FALLBACK_META: RowMeta = { label: 'ממתין', tone: 'text-gray-400', dot: 'bg-gray-300', waiting: null }

export default function FollowupsTable({
  rows,
  total,
  meta,
}: {
  rows: DueWorklistRow[]
  total: number
  meta: Record<number, RowMeta>
}) {
  const [page, setPage] = useState(0)

  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [rows])

  const visible = rows.filter((r) => !completedIds.has(r.id))
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className='overflow-hidden rounded-xl border border-border bg-surface'>
      <div className='flex items-baseline justify-between px-4 pt-3.5 pb-1'>
        <h2 className='text-sm font-semibold text-gray-700'>מעקבים</h2>
        <span className='text-xs text-gray-400 tabular-nums'>{total} בהמשך</span>
      </div>

      {visible.length === 0 ? (
        <p className='px-4 py-10 text-center text-sm text-gray-400'>אין מעקבים נוספים כרגע</p>
      ) : (
        <ul className='divide-y divide-gray-100'>
          {slice.map((row) => {
            const m = meta[row.id] ?? FALLBACK_META
            return (
              <li
                key={row.id}
                className='flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50/70'
              >
                <div className='flex min-w-0 items-center gap-2.5'>
                  <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${m.dot}`} />
                  <div className='min-w-0'>
                    <Link
                      href={`/clients/${row.id}/summary`}
                      className='block truncate text-sm font-medium text-gray-800 hover:underline'
                    >
                      {row.name || '—'}
                    </Link>
                    <p className='mt-0.5 flex items-center gap-1.5 truncate text-xs tabular-nums'>
                      <span className={m.tone}>{m.label}</span>
                      {m.waiting && (
                        <>
                          <span aria-hidden className='text-gray-300'>
                            ·
                          </span>
                          <span className='text-gray-400'>{m.waiting}</span>
                        </>
                      )}
                      {row.followUpNote && (
                        <>
                          <span aria-hidden className='text-gray-300'>
                            ·
                          </span>
                          <span className='truncate text-gray-400'>{row.followUpNote}</span>
                        </>
                      )}
                    </p>
                  </div>
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
            className='rounded-md px-3 py-1 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40'
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
            className='rounded-md px-3 py-1 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40'
          >
            הבא
          </button>
        </div>
      )}
    </div>
  )
}
