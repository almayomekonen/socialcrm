import Link from 'next/link'
import type { DashboardStats } from '@/lib/dashboard/stats'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Leads by CURRENT status (async RSC). Bars are each stage's share of all leads in
// the funnel; lost leads sit outside it. Each row opens the leads list.
const BAR = ['bg-accent/45', 'bg-accent', 'bg-primary', 'bg-success']

/** Funnel stage label by its stable status key; an unknown key shows the data label. */
const STAGE_KEY: Record<string, MessageKey> = {
  new: 'today.analytics.funnel.new',
  contacted: 'today.analytics.funnel.contacted',
  interested: 'today.analytics.funnel.interested',
  closed: 'today.analytics.funnel.closed',
}

export default async function FunnelCard({
  stats: statsPromise,
  locale = 'he',
}: {
  stats: Promise<DashboardStats | null>
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const stats = await statsPromise
  if (!stats) return null
  const total = stats.funnel.reduce((a, s) => a + s.count, 0)
  if (total === 0) return null

  return (
    <section className='flex flex-col gap-3.5 rounded-2xl border border-border bg-surface px-[22px] py-5'>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 className='text-lg font-bold text-ink'>{t('today.analytics.funnelTitle')}</h2>
        {stats.closeRate != null && (
          <span className='text-[13px] text-gray-500 tabular-nums'>
            {t('today.analytics.closeRate', { percent: Math.round(stats.closeRate * 100) })}
          </span>
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
                <span className='text-ink group-hover:underline'>{STAGE_KEY[s.key] ? t(STAGE_KEY[s.key]) : s.label}</span>
                <span className='font-semibold text-ink tabular-nums'>{s.count}</span>
              </span>
              <span className='h-2.5 overflow-hidden rounded-md bg-neutral-bg'>
                <span className={`block h-full rounded-md ${BAR[i]}`} style={{ width: `${(s.count / total) * 100}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {stats.lost > 0 && (
        <p className='border-t border-gray-100 pt-3 text-[13px] text-gray-500 tabular-nums'>{t('today.analytics.lost', { count: stats.lost })}</p>
      )}
    </section>
  )
}
