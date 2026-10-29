import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { TodayBrief } from '@/lib/today/types'
import type { Translator } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Presentational (RSC). Renders the DTO's precomputed signals as copy — it selects
// Hebrew strings from the server-decided flags (done / statusVerdict / remaining /
// volumeState / handledToday); it derives nothing.

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

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export default function BriefHero({ brief, locale = 'he' }: { brief: TodayBrief; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const pct = progressPct(brief)
  const meetings = brief.meetings.length
  return (
    <section className='flex flex-[1_1_420px] flex-col justify-between gap-5 rounded-2xl border border-border bg-surface px-7 py-[26px]'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          {brief.dateLabel && <p className='mb-0.5 text-sm text-gray-500'>{brief.dateLabel}</p>}
          <h1 className='text-[30px] leading-tight font-extrabold tracking-[-0.4px] text-ink'>
            {brief.firstName ? t('today.greetingWithName', { greeting: brief.greeting, name: brief.firstName }) : brief.greeting}
          </h1>
          <p className='mt-1.5 text-lg font-semibold text-ink tabular-nums'>{headline(brief, t)}</p>
          <p className='mt-0.5 text-sm text-gray-500 tabular-nums'>{subline(brief, t)}</p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Link
            href='/leads?add=1'
            className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[15px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-primary-text ${focusRing}`}
          >
            <Icon name='plus' className='size-4 bg-white' />
            {t('today.hero.addLead')}
          </Link>
          <Link
            href='/leads?import=1'
            className={`group inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-ink transition-colors hover:border-primary hover:text-primary-text ${focusRing}`}
          >
            <Icon name='upload' className='size-4 bg-ink group-hover:bg-primary-text' />
            {t('today.hero.importExcel')}
          </Link>
        </div>
      </div>

      {pct !== null && (
        <div>
          <div className='mb-1.5 flex justify-between gap-3 text-sm tabular-nums'>
            <span>
              <b className='font-bold text-ink'>{t('today.hero.handledToday', { count: brief.handledToday })}</b>
              <span className='text-gray-500'>
                {` · ${t('today.hero.remainingShort', { count: brief.remaining })}`}
                {meetings > 0 ? ` · ${t('today.hero.meetings', { count: meetings })}` : ''}
              </span>
            </span>
            <span className='text-gray-500'>{pct}%</span>
          </div>
          <div
            role='progressbar'
            aria-label={t('today.hero.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className='h-2 overflow-hidden rounded-lg bg-primary-tint'
          >
            <div className='h-full rounded-lg bg-primary transition-[width] duration-300' style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </section>
  )
}
