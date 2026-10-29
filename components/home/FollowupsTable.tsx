'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import LeadQuickActions from './LeadQuickActions'
import type { DueWorklistRow } from '@/db/worklist'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

const PAGE_SIZE = 8

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function urgencyOf(row: DueWorklistRow, nowMs: number): { label: MessageKey; tone: string } {
  const fu = row.nextFollowUpAt ? new Date(row.nextFollowUpAt).getTime() : null
  if (fu != null && !Number.isNaN(fu) && fu <= nowMs) {
    return fu < startOfToday()
      ? { label: 'today.followups.overdue', tone: 'text-error-text' }
      : { label: 'today.followups.dueToday', tone: 'text-warning-text' }
  }
  if (row.status === 'new') return { label: 'today.followups.new', tone: 'text-primary-text' }
  return { label: 'today.followups.waiting', tone: 'text-gray-400' }
}

export default function FollowupsTable({ rows, total, whatsappConnected }: { rows: DueWorklistRow[]; total: number; whatsappConnected?: boolean }) {
  const t = useT()
  const [page, setPage] = useState(0)

  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [rows])
  const now = Date.now()

  const visible = rows.filter((r) => !completedIds.has(r.id))
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className='rounded-lg border border-gray-200 bg-white'>
      <div className='flex items-baseline justify-between px-4 pt-3'>
        <h2 className='text-sm font-medium text-gray-700'>{t('today.followups.title')}</h2>
        <span className='text-xs text-gray-400 tabular-nums'>{t('today.followups.later', { count: total })}</span>
      </div>

      {visible.length === 0 ? (
        <p className='px-4 py-8 text-center text-sm text-gray-400'>{t('today.followups.empty')}</p>
      ) : (
        <ul className='mt-1 h-88 divide-y divide-gray-50 overflow-y-auto'>
          {slice.map((row) => {
            const u = urgencyOf(row, now)
            return (
              <li key={row.id} className='flex items-center justify-between gap-3 px-4 py-2'>
                <div className='min-w-0 flex items-baseline gap-2'>
                  <Link href={`/clients/${row.id}/summary`} className='text-sm text-gray-800 truncate hover:underline'>
                    {row.name || '—'}
                  </Link>
                  <span className={`text-xs shrink-0 ${u.tone}`}>{t(u.label)}</span>
                  {row.followUpNote && <span className='text-xs text-gray-400 truncate'>· {row.followUpNote}</span>}
                </div>
                <LeadQuickActions
                  id={row.id}
                  phone={row.phone}
                  status={row.status}
                  nextFollowUpAt={row.nextFollowUpAt}
                  quiet
                  onCompleted={() => setCompletedIds((s) => new Set(s).add(row.id))}
                  whatsappConnected={whatsappConnected}
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
            {t('today.followups.previous')}
          </button>
          <span className='text-xs text-gray-400 tabular-nums'>
            {t('today.followups.page', { current: current + 1, total: pageCount })}
          </span>
          <button
            type='button'
            onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
            disabled={current >= pageCount - 1}
            className='rounded-md px-3 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40'
          >
            {t('today.followups.next')}
          </button>
        </div>
      )}
    </div>
  )
}
