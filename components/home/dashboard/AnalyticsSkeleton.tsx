// Content-shaped placeholders for the analytics while they stream in (RSC). They
// shadow the real layout so nothing jumps; pulsing stops under reduced motion.
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

const block = 'rounded-md bg-neutral-bg motion-safe:animate-pulse'

export function AnalyticsOverviewSkeleton({ locale = 'he' }: { locale?: UiLocale } = {}) {
  return (
    <div aria-busy='true' aria-label={translatorFor(locale)('today.analytics.loading')} className='contents'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className='flex h-[116px] flex-col justify-between rounded-[14px] border border-border bg-surface px-5 py-[18px]'>
            <div className={`h-3.5 w-24 ${block}`} />
            <div className={`h-7 w-20 ${block}`} />
          </div>
        ))}
      </div>
      <div className='flex flex-wrap gap-5'>
        <div className='flex h-[330px] min-w-0 flex-[2_1_560px] flex-col gap-4 rounded-2xl border border-border bg-surface px-[22px] py-5'>
          <div className={`h-5 w-48 ${block}`} />
          <div className={`flex-1 ${block}`} />
        </div>
        <div className='flex h-[330px] min-w-0 flex-[1_1_300px] flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-[22px] py-5'>
          <div className={`h-5 w-32 self-start ${block}`} />
          <div className='size-[150px] rounded-full border-[16px] border-neutral-bg motion-safe:animate-pulse' />
        </div>
      </div>
    </div>
  )
}

export function FunnelSkeleton() {
  return (
    <div aria-hidden className='flex flex-col gap-4 rounded-2xl border border-border bg-surface px-[22px] py-5'>
      <div className={`h-5 w-32 ${block}`} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-2.5 ${block}`} />
      ))}
    </div>
  )
}
