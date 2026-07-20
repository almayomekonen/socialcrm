'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import OutcomeControl from '@/components/leads/OutcomeControl'

/**
 * The heart of the page: one large Mission Card (the single thing to do next) plus
 * quiet "next up" rows. The card is the visual centerpiece — significantly more
 * weight than anything around it — and answers "what should I do next?" instantly.
 * Optimistic completion is shared across all items: logging an outcome removes that
 * lead immediately; the server refresh reconciles by sending fresh `items`.
 * All values (reason, waiting) are precomputed server-side — no client Date().
 */
export type MissionItem = {
  lead: { id: number; name: string; phone: string | null }
  reason: string
  waiting: string | null
}

export default function MissionSection({ items }: { items: MissionItem[] }) {
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [items])
  const complete = (id: number) => setCompletedIds((s) => new Set(s).add(id))

  const visible = items.filter((it) => !completedIds.has(it.lead.id))
  if (visible.length === 0) return null
  const [mission, ...rest] = visible

  return (
    <section>
      {/* Mission Card — the centerpiece */}
      <div className='rounded-2xl border border-border bg-gradient-to-b from-primary-tint to-surface p-6 shadow-md sm:p-7'>
        <div className='flex items-center gap-1.5 text-primary-text'>
          <Icon name='bolt' className='size-4 bg-primary-text' />
          <span className='text-xs font-semibold tracking-wide'>המשימה הבאה</span>
        </div>

        <Link
          href={`/clients/${mission.lead.id}/summary`}
          className='mt-3 block truncate text-2xl font-semibold text-ink hover:underline sm:text-3xl'
        >
          {mission.lead.name || '—'}
        </Link>
        <p className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-500 tabular-nums'>
          <span className='font-medium text-gray-700'>{mission.reason}</span>
          {mission.waiting && (
            <>
              <span aria-hidden className='text-gray-300'>
                ·
              </span>
              <span>{mission.waiting}</span>
            </>
          )}
          {mission.lead.phone && (
            <>
              <span aria-hidden className='text-gray-300'>
                ·
              </span>
              <span>{mission.lead.phone}</span>
            </>
          )}
        </p>

        <div className='mt-6 flex items-center gap-2.5'>
          {mission.lead.phone && (
            <Btn
              variant='solid'
              size='large'
              icon='phone'
              lbl='התקשר'
              onClick={() => (window.location.href = `tel:${mission.lead.phone}`)}
            />
          )}
          <OutcomeControl leadId={mission.lead.id} compact onCompleted={() => complete(mission.lead.id)} />
        </div>
      </div>

      {/* Next up — quiet, subordinate */}
      {rest.length > 0 && (
        <div className='mt-4'>
          <p className='mb-2 px-1 text-xs font-medium text-gray-400'>בהמשך</p>
          <ul className='divide-y divide-gray-100 overflow-hidden rounded-xl border border-border bg-surface'>
            {rest.map(({ lead, reason, waiting }) => (
              <li
                key={lead.id}
                className='flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50/70'
              >
                <div className='min-w-0'>
                  <Link
                    href={`/clients/${lead.id}/summary`}
                    className='block truncate text-sm font-medium text-gray-800 hover:underline'
                  >
                    {lead.name || '—'}
                  </Link>
                  <p className='mt-0.5 truncate text-xs text-gray-400 tabular-nums'>
                    {reason}
                    {waiting ? ` · ${waiting}` : ''}
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  <OutcomeControl leadId={lead.id} compact onCompleted={() => complete(lead.id)} />
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
        </div>
      )}
    </section>
  )
}
