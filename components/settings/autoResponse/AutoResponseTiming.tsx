'use client'

/**
 * "תזמון ומגבלות" — the delay before a reply and the daily ceiling.
 *
 * Extracted from `AutoResponseSettingsForm.tsx` (328 lines, over the 250-line
 * soft limit — architecture-rules §1, §5) before its translation. The markup
 * moved intact; the form keeps the state and passes each value and its setter.
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
  return (
    <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
      <h2 className='text-base font-semibold text-ink'>תזמון ומגבלות</h2>
      <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>שליטה בקצב, כדי שהמענה יישאר טבעי.</p>

      {/*
        One control, not two: the pair shares a single rounded outline and is
        split by a 1px rule, so the ceiling reads as part of the same pacing
        decision as the delay. The 1px is the container's own background
        showing through `gap-px`.
      */}
      <div className='mt-4 max-w-100'>
        <div className='grid grid-cols-2 gap-px'>
          <label htmlFor={delayId} className='ps-3.25 text-sm text-gray-700'>
            המתנה לפני שליחה
          </label>
          <label htmlFor={capId} className='ps-3.25 text-sm text-gray-700'>
            מקסימום מענים ביום
          </label>
        </div>

        <div className='mt-1.75 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary'>
          <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
            <input
              id={delayId}
              type='number'
              min={0}
              max={3600}
              className='w-full min-w-0 bg-transparent text-md outline-none'
              value={delaySeconds}
              onChange={(e) => onDelaySeconds(e.target.value)}
            />
            <span className='text-sm text-gray-500'>שניות</span>
          </div>
          <div className='flex h-10 items-center gap-2 bg-white ps-3.25 pe-3.25'>
            <input
              id={capId}
              type='number'
              min={0}
              className='w-full min-w-0 bg-transparent text-md outline-none'
              value={dailyCap}
              onChange={(e) => onDailyCap(e.target.value)}
            />
            <span className='text-sm text-gray-500'>הודעות</span>
          </div>
        </div>

        <div className='mt-1.75 grid grid-cols-2 gap-px'>
          <p className='ps-3.25 text-xs text-gray-500'>אפס שולח מיד.</p>
          <p className='ps-3.25 text-xs text-gray-500'>תקרה יומית לכל העסק.</p>
        </div>
      </div>
    </section>
  )
}
