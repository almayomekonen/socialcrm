'use client'

import Link from 'next/link'
import { Btn } from '@/lib/btns/Btn'
import OutcomeControl from '@/components/leads/OutcomeControl'

/**
 * "התחל כאן" — the single recommended next contact, shown above the lanes.
 * A suggestion only (the lead also stays in its lane); always explains WHY in
 * plain Hebrew; the dominant action is the call. No score, no AI language.
 */
export default function RecommendedFirst({
  lead,
  reason,
}: {
  lead: { id: number; name: string; phone: string | null }
  reason: string
}) {
  return (
    <div className='rounded-lg border border-gray-200 bg-white p-4'>
      <p className='text-xs font-medium text-primary-text mb-1'>התחל כאן</p>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Link href={`/clients/${lead.id}/summary`} className='text-base font-semibold truncate hover:underline'>
            {lead.name || '—'}
          </Link>
          <p className='text-sm text-gray-600 truncate tabular-nums'>
            {reason}
            {lead.phone ? ` · ${lead.phone}` : ''}
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <OutcomeControl leadId={lead.id} compact />
          {lead.phone && (
            <Btn
              variant='solid'
              size='medium'
              icon='phone'
              lbl='התקשר'
              onClick={() => (window.location.href = `tel:${lead.phone}`)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
