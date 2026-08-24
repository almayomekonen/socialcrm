'use client'

import Icon from '@/lib/Icon'

/**
 * "You are looking at search results, not your whole pipeline."
 *
 * Without this line, narrowing the list to one match makes every status tab read
 * zero — indistinguishable from an empty CRM, which is exactly the "where did
 * all my leads go?" report this exists to answer. The numbers are honest either
 * way; what was missing was the sentence that explains them.
 *
 * Deliberately the SAME three elements the mobile filter bar already ships —
 * term, result count, one-tap clear — rather than a second vocabulary for the
 * same job (`ux-guidelines.md` §12, `architecture-rules.md` §10). The whole chip
 * is the button, as it is on mobile, so the target is never a 24px `×`.
 */
export default function ActiveSearchChip({
  term,
  resultCount,
  onClear,
  leads,
}: {
  term: string
  resultCount: number
  onClear: () => void
  leads: boolean
}) {
  if (!term) return null

  const noun = leads ? 'לידים' : 'לקוחות'

  return (
    <div className='flex flex-wrap items-center gap-2 mb-2 shrink-0' dir='rtl'>
      <button
        type='button'
        onClick={onClear}
        aria-label={`נקה חיפוש: ${term}`}
        className='press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary bg-primary-tint ps-3 pe-2.5 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <Icon name='magnifying-glass' type='reg' className='size-3.5 bg-primary' />
        <span className='text-[13px] font-medium text-gray-800'>{`חיפוש: "${term}"`}</span>
        <span aria-hidden className='text-[15px] leading-none text-gray-500'>
          ×
        </span>
      </button>

      {/* The count is what turns "0 / 1 / 0 / 0 / 0" from alarming into obvious. */}
      <p aria-live='polite' className='text-[12px] tabular-nums text-gray-500'>
        {resultCount === 1 ? `תוצאה אחת` : `${resultCount} ${noun}`}
      </p>
    </div>
  )
}
