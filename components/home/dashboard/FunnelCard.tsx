import Link from 'next/link'
import type { DashboardStats } from '@/lib/dashboard/stats'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Leads by CURRENT status (async RSC) — one tab of the dashboard's tabbed
// section, in the same bordered panel as the leads table. Bars are each stage's
// share of all leads in the funnel (neutral, light → dark as the lead advances);
// lost leads sit outside it. Each row opens the leads list.
const BAR = ['bg-neutral-300', 'bg-neutral-500', 'bg-neutral-700', 'bg-neutral-900']

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
    <div className='flex flex-col gap-5 rounded-lg border border-neutral-200 bg-white p-6'>
      {stats.closeRate != null && (
        <p className='text-sm text-neutral-500 tabular-nums'>
          {t('today.analytics.closeRate', { percent: Math.round(stats.closeRate * 100) })}
        </p>
      )}
      <ul className='flex flex-col gap-4'>
        {stats.funnel.map((s, i) => (
          <li key={s.key}>
            <Link
              href='/leads'
              className='group flex flex-col gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-neutral-950/15'
            >
              <span className='flex items-center gap-2.5 text-sm'>
                <span className='flex-1 font-medium text-neutral-950 group-hover:underline'>
                  {STAGE_KEY[s.key] ? t(STAGE_KEY[s.key]) : s.label}
                </span>
                <span className='text-neutral-500 tabular-nums'>{Math.round((s.count / total) * 100)}%</span>
                <span className='w-10 text-end font-medium text-neutral-950 tabular-nums'>{s.count}</span>
              </span>
              <span className='h-2 overflow-hidden rounded-full bg-neutral-100'>
                <span className={`block h-full rounded-full ${BAR[i]}`} style={{ width: `${(s.count / total) * 100}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {stats.lost > 0 && (
        <p className='border-t border-neutral-200 pt-4 text-sm text-neutral-500 tabular-nums'>{t('today.analytics.lost', { count: stats.lost })}</p>
      )}
    </div>
  )
}
