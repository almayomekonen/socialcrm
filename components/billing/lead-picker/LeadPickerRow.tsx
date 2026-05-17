'use client'

import type { RecentLead } from './types'

/**
 * Single row inside the LeadPicker dropdown panel.
 *
 * Pure presentation — receives a `RecentLead`, a "is the current lead"
 * flag, and an onClick. No state, no effects. Two visual variants:
 *   - normal: hover background
 *   - current: softy/brand tint + "נוכחי" badge
 * Plus an invoice-count badge when the lead has been billed.
 */
export default function LeadPickerRow({
  lead,
  isCurrent,
  onClick,
}: {
  lead: RecentLead
  isCurrent: boolean
  onClick: () => void
}) {
  const label =
    lead.details?.trim() ||
    `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
    'ללא שם'
  const count = lead.invoiceCount ?? 0

  return (
    <button
      type='button'
      onClick={onClick}
      className={
        'w-full text-right px-3 py-2.5 flex items-center justify-between gap-3 text-base transition-colors ' +
        (isCurrent ? 'bg-softy/60 font-medium text-solid' : 'hover:bg-gray-50 text-gray-900')
      }
    >
      <span className='truncate flex-1'>{label}</span>
      <span className='shrink-0 flex items-center gap-2'>
        {count > 0 && (
          <span
            className='text-xs font-medium text-solid bg-softy px-2 py-0.5 rounded-full tabular-nums'
            title={`${count} חשבוניות`}
          >
            {count}
          </span>
        )}
        {isCurrent && <span className='text-xs text-solid/80'>נוכחי</span>}
      </span>
    </button>
  )
}

export const dropdownGroupHeaderCls =
  'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600 bg-gray-100 border-b border-gray-200 sticky top-0 z-10'
