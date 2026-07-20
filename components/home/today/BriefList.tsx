import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { BriefItem, QualifyingState } from '@/lib/today/types'

// Presentational (RSC). The rest of the brief — dense rows, no pagination
// (INV-15). Status dot is a color chosen from the precomputed state; every row
// also carries the text reason (never color-only).
const DOT: Record<QualifyingState, string> = {
  WAITING_REPLY: 'bg-error',
  FOLLOWUP_OVERDUE: 'bg-error',
  FOLLOWUP_DUE_TODAY: 'bg-warning',
  NEW_INBOUND: 'bg-primary',
  OVERDUE_TASK: 'bg-warning',
  OPEN_LOOP_SLA: 'bg-gray-300',
}

export default function BriefList({ items }: { items: BriefItem[] }) {
  return (
    <div className='overflow-hidden rounded-xl border border-border bg-surface'>
      <p className='px-4 pt-3.5 pb-1 text-sm font-semibold text-gray-700'>בהמשך</p>
      <ul className='divide-y divide-gray-100'>
        {items.map((it) => (
          <li key={it.id} className='flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50/70'>
            <div className='flex min-w-0 items-center gap-2.5'>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[it.state]}`} />
              <div className='min-w-0'>
                <Link href={`/clients/${it.id}/summary`} className='block truncate text-sm font-medium text-gray-800 hover:underline'>
                  {it.name || '—'}
                </Link>
                <p className='mt-0.5 truncate text-xs text-gray-400'>{it.reason}</p>
              </div>
            </div>
            {it.phone && (
              <a
                href={`tel:${it.phone}`}
                aria-label={`התקשר ל${it.name || 'ליד'}`}
                className='inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-100/60'
              >
                <Icon name='phone' className='size-4 bg-black' />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
