'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import OutcomeControl from '@/components/leads/OutcomeControl'

/**
 * Recommended leads — the focal point of the dashboard.
 * #1 is the hero (largest name + the single loudest Call on the page, "התחל כאן").
 * #2/#3 are quiet supporting rows ("next up"). Collapses gracefully:
 * 0 → nothing, 1 → hero only, 2 → hero + one, 3 → hero + two. No reserved space.
 * Outcome stays visible on every row (Call → Outcome → Next).
 */
export type RecommendedItem = {
  lead: { id: number; name: string; phone: string | null }
  reason: string
  conversationId?: number | null
  windowHint?: string | null
  eyebrow?: string | null
}

function inboxHref(conversationId: number) {
  return `/inbox?conversation=${conversationId}`
}

export default function RecommendedLeads({ items }: { items: RecommendedItem[] }) {
  // Optimistic completion: a logged lead disappears immediately; the server
  // refresh reconciles by sending fresh `items`, at which point we clear the set.
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set())
  useEffect(() => setCompletedIds(new Set()), [items])
  const complete = (id: number) => setCompletedIds((s) => new Set(s).add(id))

  const visible = items.filter((it) => !completedIds.has(it.lead.id))
  if (visible.length === 0) return null
  const [hero, ...rest] = visible
  const heroInboxHref = hero.conversationId ? inboxHref(hero.conversationId) : null
  const heroHref = heroInboxHref ?? `/clients/${hero.lead.id}/summary`

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-4'>
      {/* Hero — the obvious starting point */}
      <p className='text-xs font-medium text-primary-text mb-1'>{hero.eyebrow || 'התחל כאן'}</p>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Link href={heroHref} className='block text-lg font-semibold truncate hover:underline'>
            {hero.lead.name || '—'}
          </Link>
          <p className='text-sm text-gray-600 truncate tabular-nums'>
            {hero.reason}
            {!heroInboxHref && hero.lead.phone ? ` · ${hero.lead.phone}` : ''}
          </p>
          {hero.windowHint && <p className='text-xs text-gray-500 truncate'>{hero.windowHint}</p>}
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <OutcomeControl leadId={hero.lead.id} compact onCompleted={() => complete(hero.lead.id)} />
          {heroInboxHref ? (
            <Btn variant='solid' size='medium' href={heroInboxHref} lbl='פתח שיחה' />
          ) : (
            hero.lead.phone && (
              <Btn
                variant='solid'
                size='medium'
                icon='phone'
                lbl='התקשר'
                onClick={() => (window.location.href = `tel:${hero.lead.phone}`)}
              />
            )
          )}
        </div>
      </div>

      {/* Supporting — "next up", visually subordinate */}
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
      )}
    </div>
  )
}
