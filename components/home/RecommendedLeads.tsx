'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'

export type RecommendedItem = { lead: { id: number; name: string; phone: string | null }; reason: string }

// BISECT: OutcomeControl removed from RecommendedLeads.
export default function RecommendedLeads({ items }: { items: RecommendedItem[] }) {
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [items])

  const visible = items.filter((it) => !completedIds.has(it.lead.id))
  if (visible.length === 0) return null
  const [hero, ...rest] = visible

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-4'>
      <p className='text-xs font-medium text-primary-text mb-1'>התחל כאן</p>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Link href={`/clients/${hero.lead.id}/summary`} className='block text-lg font-semibold truncate hover:underline'>
            {hero.lead.name || '—'}
          </Link>
          <p className='text-sm text-gray-600 truncate tabular-nums'>
            {hero.reason}
            {hero.lead.phone ? ` · ${hero.lead.phone}` : ''}
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          {hero.lead.phone && (
            <Btn
              variant='solid'
              size='medium'
              icon='phone'
              lbl='התקשר'
              onClick={() => (window.location.href = `tel:${hero.lead.phone}`)}
            />
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <ul className='mt-3 border-t border-gray-100 pt-2 divide-y divide-gray-100'>
          {rest.map(({ lead, reason }) => (
            <li key={lead.id} className='flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0'>
              <div className='min-w-0'>
                <Link href={`/clients/${lead.id}/summary`} className='text-sm font-medium truncate hover:underline'>
                  {lead.name || '—'}
                </Link>
                <p className='text-xs text-gray-400 truncate tabular-nums'>
                  {reason}
                  {lead.phone ? ` · ${lead.phone}` : ''}
                </p>
              </div>
              <div className='flex items-center gap-2 shrink-0'>
                {lead.phone && (
                  <Btn
                    variant='outline'
                    size='icon'
                    icon='phone'
                    aria-label='התקשר'
                    onClick={() => (window.location.href = `tel:${lead.phone}`)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
