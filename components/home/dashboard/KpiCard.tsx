import Icon from '@/lib/Icon'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import Sparkline from './Sparkline'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// One KPI tile (RSC), shadcn "section card" style: label, large value, delta
// badge in the header action slot, period + sparkline in the footer. The delta
// compares with the previous equal period and is omitted when there is no
// baseline — never a fake "0%".
type Props = {
  label: string
  value: string
  sub: string
  delta: number | null
  /** true when a rise is good (leads, revenue); false when a fall is good (response time). */
  upIsGood?: boolean
  spark: (number | null)[]
  color: string
  locale?: UiLocale
}

export default function KpiCard({ label, value, sub, delta, upIsGood = true, spark, color, locale = 'he' }: Props) {
  const good = delta == null || delta === 0 ? null : delta > 0 === upIsGood
  const tone =
    good == null
      ? 'border-neutral-border bg-neutral-bg text-neutral-text'
      : good
        ? 'border-success-border bg-success-bg text-success-text'
        : 'border-error-border bg-error-bg text-error-text'
  const iconTone = good == null ? 'bg-neutral-text' : good ? 'bg-success-text' : 'bg-error-text'
  return (
    <Card className='@container/card gap-4 bg-linear-to-t from-primary/5 to-surface'>
      <CardHeader>
        <CardDescription className='font-medium'>{label}</CardDescription>
        <CardTitle className='text-[28px] font-bold tracking-[-0.5px] tabular-nums @[250px]/card:text-[32px]'>{value}</CardTitle>
        {delta != null && (
          <CardAction>
            <Badge variant='outline' dir='ltr' className={cn('gap-1 rounded-md px-1.5 tabular-nums', tone)}>
              {delta !== 0 && <Icon name={delta > 0 ? 'arrow-trend-up' : 'arrow-trend-down'} className={cn('size-3', iconTone)} />}
              {`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}%`}
              <span className='sr-only'> {translatorFor(locale)('today.analytics.vsPrevious')}</span>
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardFooter className='items-end justify-between gap-3'>
        <span className='text-[13px] text-gray-500'>{sub}</span>
        <Sparkline values={spark} color={color} />
      </CardFooter>
    </Card>
  )
}
