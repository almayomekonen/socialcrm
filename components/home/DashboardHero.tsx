import ProgressTrack from './ProgressTrack'

/**
 * The hero — the situation at a glance. Greeting (largest, most confident type on
 * the page), a quiet "leads waiting" line, and the number-forward progress.
 * Server component: every value arrives precomputed; the only client piece is the
 * progress animation inside ProgressTrack.
 */
export default function DashboardHero({
  firstName,
  greeting,
  leadsWaiting,
  doneToday,
  progressTotal,
  progressPct,
  remaining,
}: {
  firstName: string
  greeting: string
  leadsWaiting: number
  doneToday: number
  progressTotal: number
  progressPct: number
  remaining: number
}) {
  return (
    <section className='rounded-2xl border border-border bg-surface px-6 py-6 shadow-sm sm:px-8 sm:py-7'>
      <h1 className='text-2xl font-semibold tracking-tight text-ink sm:text-3xl'>
        {greeting}
        {firstName ? `, ${firstName}` : ''}
      </h1>
      <p className='mt-1.5 text-sm text-gray-500 tabular-nums'>
        {leadsWaiting > 0 ? `${leadsWaiting} לידים ממתינים למענה` : 'אין לידים שממתינים למענה'}
      </p>
      <ProgressTrack doneToday={doneToday} progressTotal={progressTotal} pct={progressPct} remaining={remaining} />
    </section>
  )
}
