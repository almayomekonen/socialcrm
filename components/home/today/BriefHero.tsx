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

export default function BriefHero({ brief }: { brief: TodayBrief }) {
  return (
    <section className='rounded-2xl border border-border bg-surface px-6 py-6 shadow-sm sm:px-8 sm:py-7'>
      <h1 className='text-2xl font-semibold tracking-tight text-ink sm:text-3xl'>
        {brief.greeting}
        {brief.firstName ? `, ${brief.firstName}` : ''}
      </h1>
      <p className='mt-2 text-lg font-medium text-ink tabular-nums'>{headline(brief)}</p>
      <p className='mt-1 text-sm text-gray-500 tabular-nums'>{subline(brief)}</p>
    </section>
  )
}
