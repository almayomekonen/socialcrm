import Link from 'next/link'
import { DASHBOARD_RANGES, type DashboardRange } from '@/lib/dashboard/stats'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { toggleItem } from './ui'

// Period selector (RSC), shadcn ToggleGroup variant="outline" look. Plain links:
// the range lives in the URL (?range=), the server re-renders the analytics,
// back/forward restore it.
export default function RangeTabs({ range, locale = 'he' }: { range: DashboardRange; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <nav aria-label={t('today.analytics.rangeLabel')} className='flex w-fit items-center rounded-md'>
      {[...DASHBOARD_RANGES].reverse().map((r) => (
        <Link
          key={r}
          href={`/dashboard?range=${r}`}
          scroll={false}
          aria-current={r === range ? 'page' : undefined}
          className={toggleItem(r === range)}
        >
          {t('today.analytics.rangeDays', { count: r })}
        </Link>
      ))}
    </nav>
  )
}
