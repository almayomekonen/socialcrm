import Link from 'next/link'
import LeadQuickActions from './LeadQuickActions'

/**
 * Generic dashboard lead lane (used by both "New leads" and "Due worklist").
 * One coherent block: title + count, rows with a context line + the reused
 * LeadQuickActions. `total` (when given) shows the TRUE count and an honest
 * "showing X of N" when the list is capped.
 */

export type LaneLead = {
  id: number
  name: string
  phone: string | null
  status: string | null
  nextFollowUpAt?: string | Date | null
  followUpNote?: string | null
  leadSource?: string | null
}

export default function LeadLane({
  title,
  subtitle,
  rows,
  emptyMsg,
  detail,
  total,
  variant = 'secondary',
}: {
  title: string
  subtitle?: string
  rows: LaneLead[]
  emptyMsg: string
  detail: (r: LaneLead) => string
  total?: number
  /** 'primary' = the dominant work surface (bigger, roomier, brand count); 'secondary' = a lighter card. */
  variant?: 'primary' | 'secondary'
}) {
  const primary = variant === 'primary'
  const count = total ?? rows.length
  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${primary ? 'p-6' : 'px-5 py-4'}`}>
      <div className='flex items-baseline justify-between mb-3'>
        <div>
          <h2 className={`${primary ? 'text-lg' : 'text-base'} font-semibold`}>{title}</h2>
          {subtitle && <p className='text-xs text-gray-500'>{subtitle}</p>}
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full tabular-nums ${
            primary ? 'bg-primary-soft text-primary-text' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {count}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className='text-sm text-gray-500 py-4'>{emptyMsg}</p>
      ) : (
        <ul className='divide-y divide-gray-100'>
          {rows.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 ${primary ? 'py-3' : 'py-2'}`}>
              <div className='min-w-0'>
                <Link href={`/clients/${r.id}/summary`} className='font-medium truncate underline'>
                  {r.name || '—'}
                </Link>
                <p className='text-xs text-gray-500 truncate tabular-nums'>{detail(r)}</p>
              </div>
              <LeadQuickActions id={r.id} phone={r.phone} status={r.status} nextFollowUpAt={r.nextFollowUpAt} />
            </li>
          ))}
        </ul>
      )}

      {total != null && total > rows.length && (
        <p className='text-xs text-gray-400 mt-2 tabular-nums'>{`מוצגים ${rows.length} מתוך ${total}`}</p>
      )}
    </div>
  )
}
