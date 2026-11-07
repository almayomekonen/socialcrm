import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { TodayBrief } from '@/lib/today/types'
import type { Translator } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card } from '@/components/home/dashboard/card'
import { btn } from '@/components/home/dashboard/ui'

// Presentational (RSC). Renders the DTO's precomputed signals — it selects strings
// from the server-decided flags (done / statusVerdict / remaining / volumeState /
// handledToday); it derives nothing.
//
// Layout (owner mockup 2026-11-07): greeting header with a time-of-day tile and the
// two lead actions; then "leads waiting for you" with the remaining count as the
// hero number, an attention badge, today's progress and the handled / remaining line.

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

/** Sun by day, moon in the evening — matched on the server-chosen greeting text. */
function dayIcon(b: TodayBrief, t: Translator) {
  return b.greeting === t('today.greeting.evening') ? 'moon' : 'sun'
}

export default function BriefHero({ brief, locale = 'he' }: { brief: TodayBrief; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const pct = progressPct(brief)
  const meetings = brief.meetings.length
  return (
    <Card className='relative gap-0 overflow-hidden rounded-2xl px-6 py-6 shadow-[0_8px_30px_-12px_rgb(94_106_210/0.25)]'>
      {/* Header: time-of-day tile, greeting, date; lead actions at the end. */}
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-3.5'>
          <span className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-tint'>
            <Icon name={dayIcon(brief, t)} className='size-6 shrink-0 bg-primary' />
          </span>
          <div className='min-w-0'>
            <h1 className='truncate text-2xl font-bold text-ink'>
              {brief.firstName ? t('today.greetingWithName', { greeting: brief.greeting, name: brief.firstName }) : brief.greeting}
            </h1>
            <p className='mt-0.5 flex flex-wrap gap-x-1.5 text-sm text-gray-500'>
              {brief.dateLabel && (
                <>
                  <span>{brief.dateLabel}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>{t('today.hero.overview')}</span>
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Link href='/leads?import=1' className={`${btn.base} ${btn.outline} h-10 px-4`}>
            <Icon name='upload' className='size-4 shrink-0 bg-ink' />
            {t('today.hero.importExcel')}
          </Link>
          <Link href='/leads?add=1' className={`${btn.base} ${btn.default} h-10 px-4`}>
            <Icon name='plus' className='size-4 shrink-0 bg-white' />
            {t('today.hero.addLead')}
          </Link>
        </div>
      </div>

      <div className='relative mt-5 flex flex-1 flex-col border-t border-border pt-5'>
        {/* Decorative wave behind the hero number. */}
        <svg
          aria-hidden
          viewBox='0 0 400 120'
          preserveAspectRatio='none'
          className='pointer-events-none absolute end-0 top-4 h-28 w-3/5 text-primary'
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 20%, black 75%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 20%, black 75%, transparent)',
          }}
        >
          <defs>
            <linearGradient id='heroWave' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='currentColor' stopOpacity='0.16' />
              <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
            </linearGradient>
          </defs>
          <path d='M0 85 C 60 40, 110 110, 180 70 S 300 5, 400 45 L 400 120 L 0 120 Z' fill='url(#heroWave)' />
          <path d='M0 85 C 60 40, 110 110, 180 70 S 300 5, 400 45' fill='none' stroke='currentColor' strokeOpacity='0.18' strokeWidth='2' />
        </svg>

        <div className='relative flex items-center gap-2'>
          <Icon name='bolt' className='size-5 shrink-0 bg-primary' />
          <h2 className='text-lg font-semibold text-ink'>{t('today.hero.waitingTitle')}</h2>
        </div>
        <p className='sr-only'>{headline(brief, t)}</p>

        <div className='relative mt-2 flex flex-wrap items-center gap-4'>
          <span className='text-6xl leading-none font-extrabold tracking-tight text-primary tabular-nums'>{brief.remaining}</span>
          {brief.remaining > 0 ? (
            <span className='rounded-full bg-warning-bg px-3.5 py-1.5 text-sm font-semibold text-warning-text'>{t('today.hero.needsAttention')}</span>
          ) : (
            <span className='rounded-full bg-success-bg px-3.5 py-1.5 text-sm font-semibold text-success-text'>{headline(brief, t)}</span>
          )}
        </div>
        <p className='relative mt-2 text-sm text-gray-500 tabular-nums'>{subline(brief, t)}</p>

        {pct !== null && (
          <div className='relative mt-auto flex flex-col gap-3 pt-5'>
            <div className='flex items-center gap-3'>
              <div
                role='progressbar'
                aria-label={t('today.hero.progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className='h-2.5 flex-1 overflow-hidden rounded-full bg-primary-tint'
              >
                <div className='h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none' style={{ width: `${pct}%` }} />
              </div>
              <span className='w-10 text-end text-sm text-gray-500 tabular-nums'>{pct}%</span>
            </div>
            <p className='flex flex-wrap gap-x-1.5 text-sm text-gray-500 tabular-nums'>
              <span className='font-semibold text-ink'>{t('today.hero.handledToday', { count: brief.handledToday })}</span>
              <span aria-hidden>·</span>
              <span>{t('today.hero.remainingShort', { count: brief.remaining })}</span>
              {meetings > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('today.hero.meetings', { count: meetings })}</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
