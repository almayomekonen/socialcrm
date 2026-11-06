import Link from 'next/link'
import Icon from '@/lib/Icon'
import { cn } from '@/lib/utils'
import type { TodayBrief } from '@/lib/today/types'
import type { Translator } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardDescription, CardFooter, CardHeader } from '@/components/home/dashboard/card'
import { btn, sectionCard } from '@/components/home/dashboard/ui'

// Presentational (RSC). Renders the DTO's precomputed signals as copy — it selects
// strings from the server-decided flags (done / statusVerdict / remaining /
// volumeState / handledToday); it derives nothing.
//
// shadcn dashboard-01 section card: date as the description, the greeting as the
// title, the two lead actions in the action slot; the footer holds the headline
// (bold), the subline (muted) and today's progress.

function headline(b: TodayBrief, t: Translator): string {
  if (b.done) return b.statusVerdict === 'covered' ? t('today.hero.doneCovered') : t('today.hero.doneNone')
  return t('today.hero.remaining', { count: b.remaining })
}

function subline(b: TodayBrief, t: Translator): string {
  if (b.statusVerdict === 'unconfirmed') return t('today.hero.unconfirmed')
  if (b.done) return t('today.hero.allHandled')
  if (b.volumeState === 'busy') return t('today.hero.busy')
  return b.handledToday > 0 ? t('today.hero.handledSoFar', { count: b.handledToday }) : t('today.hero.start')
}

// Progress measures the brief itself (handled vs still owed today), never all due
// work. Both zero means there is nothing to measure — the bar is hidden.
function progressPct(b: TodayBrief): number | null {
  const total = b.handledToday + b.remaining
  return total > 0 ? Math.round((b.handledToday / total) * 100) : null
}

export default function BriefHero({ brief, locale = 'he' }: { brief: TodayBrief; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const pct = progressPct(brief)
  const meetings = brief.meetings.length
  return (
    <Card className={cn('@container/card justify-between', sectionCard)}>
      <CardHeader>
        {brief.dateLabel && <CardDescription>{brief.dateLabel}</CardDescription>}
        <h1 data-slot='card-title' className='text-2xl font-semibold text-neutral-950 @[250px]/card:text-3xl'>
          {brief.firstName ? t('today.greetingWithName', { greeting: brief.greeting, name: brief.firstName }) : brief.greeting}
        </h1>
        <CardAction className='flex flex-wrap justify-end gap-2'>
          <Link href='/leads?import=1' className={`${btn.base} ${btn.outline} ${btn.sm}`}>
            <Icon name='upload' className='size-4 shrink-0 bg-neutral-950' />
            {t('today.hero.importExcel')}
          </Link>
          <Link href='/leads?add=1' className={`${btn.base} ${btn.default} ${btn.sm}`}>
            <Icon name='plus' className='size-4 shrink-0 bg-white' />
            {t('today.hero.addLead')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardFooter className='flex-col items-stretch gap-1.5 text-sm'>
        <div className='line-clamp-1 flex items-center gap-2 font-medium tabular-nums'>
          {headline(brief, t)}
          <Icon name={brief.done ? 'circle-check' : 'bolt'} className='size-4 shrink-0 bg-neutral-950' />
        </div>
        <div className='text-neutral-500 tabular-nums'>{subline(brief, t)}</div>
        {pct !== null && (
          <div className='mt-3 flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-3 text-neutral-500 tabular-nums'>
              <span className='flex flex-wrap gap-x-1.5'>
                <span className='font-medium text-neutral-950'>{t('today.hero.handledToday', { count: brief.handledToday })}</span>
                <span aria-hidden>·</span>
                <span>{t('today.hero.remainingShort', { count: brief.remaining })}</span>
                {meetings > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t('today.hero.meetings', { count: meetings })}</span>
                  </>
                )}
              </span>
              <span>{pct}%</span>
            </div>
            <div
              role='progressbar'
              aria-label={t('today.hero.progress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className='h-2 w-full overflow-hidden rounded-full bg-neutral-900/20'
            >
              <div className='h-full bg-neutral-900 transition-[width] motion-reduce:transition-none' style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
