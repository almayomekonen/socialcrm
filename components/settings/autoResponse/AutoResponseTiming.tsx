'use client'

import { useT } from '@/lib/i18n/I18nProvider'

/**
 * "תזמון ומגבלות" — the delay before a reply and the daily ceiling.
 *
 * Extracted from `AutoResponseSettingsForm.tsx` (328 lines, over the 250-line
 * soft limit — architecture-rules §1, §5) before its translation. The form keeps
 * the state and passes each value and its setter.
 *
 * The cap's helper says what reaching it does, read from the worker: once the
 * agency's sent count for the day reaches the cap, new inbound turns are skipped
 * (`daily_cap`, non-resumable) and wait for a person. The count resets on the
 * database's day boundary, so the copy says "the next day", never "midnight".
 */
type Props = {
  delayId: string
  capId: string
  delaySeconds: string
  dailyCap: string
  onDelaySeconds: (value: string) => void
  onDailyCap: (value: string) => void
}

export default function AutoResponseTiming({ delayId, capId, delaySeconds, dailyCap, onDelaySeconds, onDailyCap }: Props) {
  const t = useT()
  return (
    <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
      <h2 className='text-base font-semibold text-ink'>{t('admin.autoResponse.timing.title')}</h2>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.timing.intro')}</p>

      {/*
        One control, not two: the pair shares a single rounded outline and is
        split by a 1px rule, so the ceiling reads as part of the same pacing
        decision as the delay. The 1px is the container's own background
        showing through `gap-px`.
      */}
      <div className='mt-4'>
        <div className='grid grid-cols-2 gap-px'>
          <label htmlFor={delayId} className='ps-3.25 text-sm font-semibold text-gray-700'>
            {t('admin.autoResponse.timing.delay')}
          </label>
          <label htmlFor={capId} className='ps-3.25 text-sm font-semibold text-gray-700'>
            {t('admin.autoResponse.timing.cap')}
          </label>
        </div>

        <div className='mt-0.5 grid grid-cols-2 gap-px'>
          <p id={`${delayId}-hint`} className='ps-3.25 text-xs leading-relaxed text-gray-500'>
            {t('admin.autoResponse.timing.delayHint')}
          </p>
          <p id={`${capId}-hint`} className='ps-3.25 text-xs leading-relaxed text-gray-500'>
            {t('admin.autoResponse.timing.capHint')} {t('admin.autoResponse.timing.capReached')}
          </p>
        </div>

        <div className='mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary'>
          <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
            <input
              id={delayId}
              type='number'
              min={0}
              max={3600}
              className='w-full min-w-0 bg-transparent text-md outline-none'
              value={delaySeconds}
              aria-describedby={`${delayId}-hint`}
              onChange={(e) => onDelaySeconds(e.target.value)}
            />
            <span className='text-sm text-gray-500'>{t('admin.autoResponse.timing.seconds')}</span>
          </div>
          <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
            <input
              id={capId}
              type='number'
              min={0}
              className='w-full min-w-0 bg-transparent text-md outline-none'
              value={dailyCap}
              aria-describedby={`${capId}-hint`}
              onChange={(e) => onDailyCap(e.target.value)}
            />
            <span className='text-sm text-gray-500'>{t('admin.autoResponse.timing.messages')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
