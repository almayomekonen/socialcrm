import Link from 'next/link'
import type { DashboardStats } from '@/lib/dashboard/stats'

// Leads by CURRENT status (async RSC). Bars are each stage's share of all leads in
// the funnel; lost leads sit outside it. Each row opens the leads list.
const BAR = ['bg-accent/45', 'bg-accent', 'bg-primary', 'bg-success']

export default async function FunnelCard({ stats: statsPromise }: { stats: Promise<DashboardStats | null> }) {
  const stats = await statsPromise
  if (!stats) return null
  const total = stats.funnel.reduce((a, s) => a + s.count, 0)
  if (total === 0) return null

  return (
    <section className='flex flex-col gap-3.5 rounded-2xl border border-border bg-surface px-[22px] py-5'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 className='text-lg font-bold text-ink'>משפך מכירות</h2>
        {stats.closeRate != null && (
          <span className='text-[13px] text-gray-500 tabular-nums'>שיעור סגירה {Math.round(stats.closeRate * 100)}%</span>
        )}
      </div>
      <ul className='flex flex-col gap-3'>
        {stats.funnel.map((s, i) => (
          <li key={s.key}>
            <Link
              href='/leads'
              className='group flex flex-col gap-[5px] rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
            >
              <span className='flex justify-between text-sm'>
                <span className='text-ink group-hover:underline'>{s.label}</span>
                <span className='font-semibold text-ink tabular-nums'>{s.count}</span>
              </span>
              <span className='h-2.5 overflow-hidden rounded-md bg-neutral-bg'>
                <span className={`block h-full rounded-md ${BAR[i]}`} style={{ width: `${(s.count / total) * 100}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {stats.lost > 0 && <p className='border-t border-gray-100 pt-3 text-[13px] text-gray-500 tabular-nums'>אבודים: {stats.lost}</p>}
    </section>
  )
}
