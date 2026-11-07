import Link from 'next/link'
import type { DashboardStats } from '@/lib/dashboard/stats'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Leads by CURRENT status (async RSC) — one tab of the dashboard's tabbed
// section, in the same bordered panel as the leads table. Bars are each stage's
// share of all leads in the funnel (brand accent → primary → success as the lead advances);
// lost leads sit outside it. Each row opens the leads list.
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
    <div className='flex flex-col gap-5 rounded-lg border border-border bg-surface p-6'>
      {stats.closeRate != null && (
        <p className='text-sm text-gray-500 tabular-nums'>
          {t('today.analytics.closeRate', { percent: Math.round(stats.closeRate * 100) })}
        </p>
      )}
      <ul className='flex flex-col gap-4'>
        {stats.funnel.map((s, i) => (
          <li key={s.key}>
            <Link
              href='/leads'
              className='group flex flex-col gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25'
            >
              <span className='flex items-center gap-2.5 text-sm'>
                <span className='flex-1 font-medium text-ink group-hover:underline'>
                  {STAGE_KEY[s.key] ? t(STAGE_KEY[s.key]) : s.label}
                </span>
                <span className='text-gray-500 tabular-nums'>{Math.round((s.count / total) * 100)}%</span>
                <span className='w-10 text-end font-medium text-ink tabular-nums'>{s.count}</span>
              </span>
              <span className='h-2 overflow-hidden rounded-full bg-neutral-bg'>
                <span className={`block h-full rounded-full ${BAR[i]}`} style={{ width: `${(s.count / total) * 100}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {stats.lost > 0 && (
        <p className='border-t border-border pt-4 text-sm text-gray-500 tabular-nums'>{t('today.analytics.lost', { count: stats.lost })}</p>
      )}
    </div>
  )
}
