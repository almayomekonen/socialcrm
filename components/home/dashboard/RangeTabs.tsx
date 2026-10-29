import Link from 'next/link'
import { DASHBOARD_RANGES, type DashboardRange } from '@/lib/dashboard/stats'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Period selector (RSC). Plain links: the range lives in the URL (?range=), the
// server re-renders the analytics, back/forward restore it.
export default function RangeTabs({ range, locale = 'he' }: { range: DashboardRange; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <nav aria-label={t('today.analytics.rangeLabel')} className='flex gap-0.5 rounded-[10px] bg-neutral-bg p-[3px]'>
      {DASHBOARD_RANGES.map((r) => (
        <Link
          key={r}
          href={`/dashboard?range=${r}`}
          scroll={false}
          aria-current={r === range ? 'page' : undefined}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            r === range ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_23_42/0.08)]' : 'text-gray-500 hover:text-ink'
          }`}
        >
          {t('today.analytics.rangeDays', { count: r })}
        </Link>
      ))}
    </nav>
  )
}
