import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { TodayBrief } from '@/lib/today/types'
import type { Translator } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/home/dashboard/card'
import HeroProgressRing from './HeroProgressRing'

// Presentational (RSC). Renders the DTO's precomputed signals as copy — it selects
// Hebrew strings from the server-decided flags (done / statusVerdict / remaining /
// volumeState / handledToday); it derives nothing.
//
// shadcn card: date + greeting in the header with the two lead actions in the
// action slot; below, a radial progress ring beside the headline and the day's
// counts as stat badges.

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
// work. Both zero means there is nothing to measure — the ring is hidden.
function progressPct(b: TodayBrief): number | null {
  const total = b.handledToday + b.remaining
  return total > 0 ? Math.round((b.handledToday / total) * 100) : null
}

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const stat = 'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums'

export default function BriefHero({ brief, locale = 'he' }: { brief: TodayBrief; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const pct = progressPct(brief)
  const meetings = brief.meetings.length
  return (
    <Card className='@container/hero flex-[1_1_460px] justify-between overflow-hidden bg-linear-to-br from-primary-tint/60 via-surface to-surface'>
      <CardHeader className='gap-1'>
        {brief.dateLabel && <CardDescription>{brief.dateLabel}</CardDescription>}
        <h1 data-slot='card-title' className='text-[28px] leading-tight font-bold tracking-[-0.4px] text-ink'>
          {brief.firstName ? t('today.greetingWithName', { greeting: brief.greeting, name: brief.firstName }) : brief.greeting}
        </h1>
        <CardAction className='flex flex-wrap justify-end gap-2'>
          <Link
            href='/leads?add=1'
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold whitespace-nowrap text-white shadow-[0_1px_2px_rgb(15_23_42/0.12)] transition-colors hover:bg-primary-text ${focusRing}`}
          >
            <Icon name='plus' className='size-4 bg-white' />
            {t('today.hero.addLead')}
          </Link>
          <Link
            href='/leads?import=1'
            className={`group inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold whitespace-nowrap text-ink shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-colors hover:border-primary hover:text-primary-text ${focusRing}`}
          >
            <Icon name='upload' className='size-4 bg-ink group-hover:bg-primary-text' />
            {t('today.hero.importExcel')}
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent className='flex items-center gap-6'>
        {pct !== null && (
          <div
            role='progressbar'
            aria-label={t('today.hero.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className='shrink-0'
          >
            <HeroProgressRing pct={pct} caption={t('today.hero.progress')} />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <p className='text-xl font-semibold text-ink tabular-nums'>{headline(brief, t)}</p>
          <p className='mt-1 text-sm text-gray-500 tabular-nums'>{subline(brief, t)}</p>
          {pct !== null && (
            <div className='mt-4 flex flex-wrap gap-2'>
              <span className={`${stat} border-success-border bg-success-bg text-success-text`}>
                <Icon name='circle-check' className='size-3.5 bg-success-text' />
                {t('today.hero.handledToday', { count: brief.handledToday })}
              </span>
              <span className={`${stat} border-info-border bg-primary-tint text-primary-text`}>
                <Icon name='bolt' className='size-3.5 bg-primary-text' />
                {t('today.hero.remainingShort', { count: brief.remaining })}
              </span>
              {meetings > 0 && (
                <span className={`${stat} border-neutral-border bg-neutral-bg text-neutral-text`}>
                  <Icon name='calendar' className='size-3.5 bg-neutral-text' />
                  {t('today.hero.meetings', { count: meetings })}
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
