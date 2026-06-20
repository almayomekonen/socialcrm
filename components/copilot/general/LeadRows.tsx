'use client'

import type { BriefingLeadRow } from '@/db/briefing'
import DeepLink from './DeepLink'

/** Shared renderer for a {total, sample} lead list: capped names + "and N more". */
export default function LeadRows({
  total,
  sample,
  emptyText,
  source,
}: {
  total: number
  sample: BriefingLeadRow[]
  emptyText: string
  source: string
}) {
  if (total === 0) return <p className='text-xs text-gray-400'>{emptyText}</p>
  return (
    <ul className='space-y-0.5'>
      {sample.map((l) => (
        <li key={l.id}>
          <DeepLink
            href={`/clients/${l.id}/summary`}
            source={source}
            className='block truncate text-sm text-gray-700 hover:text-gray-900'
          >
            {l.name || 'ללא שם'}
          </DeepLink>
        </li>
      ))}
      {total > sample.length && <li className='text-[11px] text-gray-400'>ועוד {total - sample.length}</li>}
    </ul>
  )
}
