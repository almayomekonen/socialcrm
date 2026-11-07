// Content-shaped placeholders for the analytics while they stream in (RSC). They
// shadow the real dashboard-01 layout so nothing jumps; pulsing stops under
// reduced motion.
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardContent, CardFooter, CardHeader } from './card'

const block = 'rounded-md bg-neutral-bg motion-safe:animate-pulse'

export function AnalyticsOverviewSkeleton({ locale = 'he' }: { locale?: UiLocale } = {}) {
  return (
    <div aria-busy='true' aria-label={translatorFor(locale)('today.analytics.loading')} className='contents'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className={`h-4 w-24 ${block}`} />
              <div className={`mt-1 h-8 w-28 ${block}`} />
            </CardHeader>
            <CardFooter className='flex-col items-start gap-2'>
              <div className={`h-4 w-40 ${block}`} />
              <div className={`h-4 w-32 ${block}`} />
            </CardFooter>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className={`h-4 w-40 ${block}`} />
          <div className={`h-4 w-28 ${block}`} />
        </CardHeader>
        <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
          <div className={`h-[250px] ${block}`} />
        </CardContent>
      </Card>
    </div>
  )
}

/** A tab panel (sources) while it streams in. */
export function PanelSkeleton() {
  return (
    <div aria-hidden className='flex items-center gap-8 rounded-lg border border-border bg-surface p-6'>
      <div className='size-[180px] shrink-0 rounded-full border-[26px] border-neutral-bg motion-safe:animate-pulse' />
      <div className='flex flex-1 flex-col gap-4'>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-2 ${block}`} />
        ))}
      </div>
    </div>
  )
}

export function FunnelSkeleton() {
  return (
    <div aria-hidden className='flex flex-col gap-5 rounded-lg border border-border bg-surface p-6'>
      <div className={`h-4 w-32 ${block}`} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-2 ${block}`} />
      ))}
    </div>
  )
}
