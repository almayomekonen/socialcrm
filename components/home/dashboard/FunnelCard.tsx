import Link from 'next/link'
import type { DashboardStats } from '@/lib/dashboard/stats'
import type { MessageKey } from '@/lib/i18n/translate'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'

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
    <Card className='gap-5'>
      <CardHeader>
        <CardTitle>{t('today.analytics.funnelTitle')}</CardTitle>
        {stats.closeRate != null && (
          <CardDescription className='tabular-nums'>
            {t('today.analytics.closeRate', { percent: Math.round(stats.closeRate * 100) })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col gap-3.5'>
          {stats.funnel.map((s, i) => (
            <li key={s.key}>
              <Link
                href='/leads'
                className='group flex flex-col gap-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary'
              >
                <span className='flex items-center gap-2.5 text-sm'>
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${BAR[i]}`} />
                  <span className='flex-1 text-ink group-hover:underline'>{STAGE_KEY[s.key] ? t(STAGE_KEY[s.key]) : s.label}</span>
                  <span className='text-gray-500 tabular-nums'>{Math.round((s.count / total) * 100)}%</span>
                  <span className='w-9 text-end font-semibold text-ink tabular-nums'>{s.count}</span>
                </span>
                <span className='h-2 overflow-hidden rounded-full bg-neutral-bg'>
                  <span className={`block h-full rounded-full ${BAR[i]}`} style={{ width: `${(s.count / total) * 100}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      {stats.lost > 0 && (
        <CardFooter className='-mb-2 border-t border-border text-[13px] text-gray-500 tabular-nums [.border-t]:pt-4'>
          {t('today.analytics.lost', { count: stats.lost })}
        </CardFooter>
      )}
    </Card>
  )
}
