import Icon from '@/lib/Icon'
import { cn } from '@/lib/utils'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import { badgeOutline, sectionCard } from './ui'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// One KPI tile (RSC) — the shadcn dashboard-01 "section card": label, large
// value, outline trend badge in the header action, then a bold trend line and a
// muted period line. The delta compares with the previous equal period and is
// omitted when there is no baseline — never a fake "0%".
type Props = {
  label: string
  value: string
  sub: string
  delta: number | null
  /** true when a rise is good (leads, revenue); false when a fall is good (response time). */
  upIsGood?: boolean
  locale?: UiLocale
}

export default function KpiCard({ label, value, sub, delta, upIsGood = true, locale = 'he' }: Props) {
  const t = translatorFor(locale)
  const tone = delta == null || delta === 0 ? 'neutral' : delta > 0 === upIsGood ? 'good' : 'bad'
  const pct = delta == null ? '' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`
  const trendIcon = delta != null && delta < 0 ? 'arrow-trend-down' : 'arrow-trend-up'
  return (
    <Card className={cn('@container/card', sectionCard)}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>{value}</CardTitle>
        {delta != null && (
          <CardAction>
            <span data-tone={tone} dir='ltr' className={cn(badgeOutline, 'tabular-nums')}>
              {delta !== 0 && <Icon name={trendIcon} className='size-3 shrink-0 bg-neutral-950' />}
              {pct}
              <span className='sr-only'> {t('today.analytics.vsPrevious')}</span>
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className='flex-col items-start gap-1.5 text-sm'>
        {delta != null && delta !== 0 && (
          <div className='line-clamp-1 flex items-center gap-2 font-medium'>
            <span dir='ltr' className='tabular-nums'>{pct}</span> {t('today.analytics.vsPrevious')}
            <Icon name={trendIcon} className='size-4 shrink-0 bg-neutral-950' />
          </div>
        )}
        <div className='text-neutral-500'>{sub}</div>
      </CardFooter>
    </Card>
  )
}
