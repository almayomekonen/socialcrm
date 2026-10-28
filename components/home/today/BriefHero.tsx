import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { TodayBrief } from '@/lib/today/types'

// Presentational (RSC). Renders the DTO's precomputed signals as copy — it selects
// Hebrew strings from the server-decided flags (done / statusVerdict / remaining /
// volumeState / handledToday); it derives nothing.

function headline(b: TodayBrief): string {
  if (b.done) return b.statusVerdict === 'covered' ? 'סיימת להיום — הכול תחת שליטה' : 'אין כרגע לידים שדורשים אותך'
  return b.remaining === 1 ? 'ליד אחד דורש אותך היום' : `${b.remaining} לידים דורשים אותך היום`
}

function subline(b: TodayBrief): string {
  if (b.statusVerdict === 'unconfirmed') return 'לא ניתן לאשר שהכול מעודכן כרגע'
  if (b.done) return 'כל מה שדורש אותך היום טופל'
  if (b.volumeState === 'busy') return 'יום עמוס — התחל מהמשימה הראשונה'
  return b.handledToday > 0 ? `טופלו היום ${b.handledToday}` : 'התחל מהמשימה הראשונה'
}

// Progress measures the brief itself (handled vs still owed today), never all due
// work. Both zero means there is nothing to measure — the bar is hidden.
function progressPct(b: TodayBrief): number | null {
  const total = b.handledToday + b.remaining
  return total > 0 ? Math.round((b.handledToday / total) * 100) : null
}

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export default function BriefHero({ brief }: { brief: TodayBrief }) {
  const pct = progressPct(brief)
  const meetings = brief.meetings.length
  return (
    <section className='flex flex-[1_1_420px] flex-col justify-between gap-5 rounded-2xl border border-border bg-surface px-7 py-[26px]'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          {brief.dateLabel && <p className='mb-0.5 text-sm text-gray-500'>{brief.dateLabel}</p>}
          <h1 className='text-[30px] leading-tight font-extrabold tracking-[-0.4px] text-ink'>
            {brief.greeting}
            {brief.firstName ? `, ${brief.firstName}` : ''}
          </h1>
          <p className='mt-1.5 text-lg font-semibold text-ink tabular-nums'>{headline(brief)}</p>
          <p className='mt-0.5 text-sm text-gray-500 tabular-nums'>{subline(brief)}</p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Link
            href='/leads?add=1'
            className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[15px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-primary-text ${focusRing}`}
          >
            <Icon name='plus' className='size-4 bg-white' />
            הוסף ליד
          </Link>
          <Link
            href='/leads?import=1'
            className={`group inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-4 text-[15px] font-semibold whitespace-nowrap text-ink transition-colors hover:border-primary hover:text-primary-text ${focusRing}`}
          >
            <Icon name='upload' className='size-4 bg-ink group-hover:bg-primary-text' />
            ייבוא Excel
          </Link>
        </div>
      </div>

      {pct !== null && (
        <div>
          <div className='mb-1.5 flex justify-between gap-3 text-sm tabular-nums'>
            <span>
              <b className='font-bold text-ink'>{brief.handledToday} טופלו היום</b>
              <span className='text-gray-500'>
                {` · ${brief.remaining} נותרו`}
                {meetings > 0 ? ` · ${meetings === 1 ? 'פגישה אחת' : `${meetings} פגישות`}` : ''}
              </span>
            </span>
            <span className='text-gray-500'>{pct}%</span>
          </div>
          <div
            role='progressbar'
            aria-label='התקדמות היום'
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
