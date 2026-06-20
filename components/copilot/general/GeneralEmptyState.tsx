'use client'

import Icon from '@/lib/Icon'
import DeepLink from './DeepLink'

/**
 * First-class onboarding for accounts with NO leads. Mirrors EmptyTimelineState
 * styling. Answers the three empty-state questions (what / why / next) and
 * leads with the two primary CTAs — no empty briefing, no zero-value metrics.
 */
export default function GeneralEmptyState() {
  return (
    <div className='h-full flex flex-col items-center justify-center gap-4 select-none px-6 text-center'>
      <Icon name='sparkles' type='reg' className='size-6 bg-gray-300' />
      <div className='space-y-1'>
        <p className='text-sm font-medium text-gray-700'>עוד אין לידים</p>
        <p className='text-xs text-gray-500'>כדי להתחיל, הוסף ליד או העלה קובץ אקסל</p>
      </div>
      <div className='flex w-full max-w-[220px] flex-col gap-2'>
        <DeepLink
          href='/leads'
          source='empty-state'
          className='rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors'
        >
          הוסף ליד
        </DeepLink>
        <DeepLink
          href='/leads'
          source='empty-state'
          className='rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'
        >
          העלה לידים
        </DeepLink>
      </div>
    </div>
  )
}
