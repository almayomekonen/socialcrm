// Content-shaped placeholders for the analytics while they stream in (RSC). They
// shadow the real card layout so nothing jumps; pulsing stops under reduced motion.
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardContent, CardHeader } from './card'

const block = 'rounded-md bg-neutral-bg motion-safe:animate-pulse'

export function AnalyticsOverviewSkeleton({ locale = 'he' }: { locale?: UiLocale } = {}) {
  return (
    <div aria-busy='true' aria-label={translatorFor(locale)('today.analytics.loading')} className='contents'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className='h-[150px] justify-between gap-4'>
            <CardHeader>
              <div className={`h-3.5 w-24 ${block}`} />
              <div className={`mt-1 h-8 w-20 ${block}`} />
            </CardHeader>
            <CardContent>
              <div className={`h-3 w-32 ${block}`} />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className='flex flex-wrap gap-4'>
        <Card className='h-[400px] flex-[2_1_560px]'>
          <CardHeader>
            <div className={`h-4 w-40 ${block}`} />
            <div className={`h-3.5 w-24 ${block}`} />
          </CardHeader>
          <CardContent className='flex-1'>
            <div className={`h-full ${block}`} />
          </CardContent>
        </Card>
        <Card className='h-[400px] flex-[1_1_300px] items-center'>
          <CardHeader className='w-full'>
            <div className={`h-4 w-32 ${block}`} />
          </CardHeader>
          <div className='size-[180px] rounded-full border-[26px] border-neutral-bg motion-safe:animate-pulse' />
        </Card>
      </div>
    </div>
  )
}

export function FunnelSkeleton() {
  return (
    <Card aria-hidden className='gap-5'>
      <CardHeader>
        <div className={`h-4 w-32 ${block}`} />
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-2 ${block}`} />
        ))}
      </CardContent>
    </Card>
  )
}
