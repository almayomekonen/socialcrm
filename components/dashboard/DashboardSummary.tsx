import { formatCurrency } from '@/lib/funcs'
import Link from 'next/link'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** The date range the deals page falls back to (see getPermsAndFilter). */
const CURRENT_MONTH = 'החודש הנוכחי'

/**
 * "This month's revenue" only when the active filter really is this month;
 * any other period (all dates, a past month, a custom range, a closing-date
 * range) gets a neutral label so the card never claims to be monthly.
 */
export function revenueLabel(
  rawFilter: { dateRange?: string; saleDtRange?: string } | null | undefined,
  locale: UiLocale = 'he',
): string {
  const saleDtRange = rawFilter?.saleDtRange
  // Compares the STORED date-range values (the filter JSON), never display text.
  const onlyThisMonth = rawFilter?.dateRange === CURRENT_MONTH && (!saleDtRange || saleDtRange === 'כל התאריכים')
  const t = translatorFor(locale)
  return onlyThisMonth ? t('deals.page.summary.revenueMonth') : t('deals.page.summary.revenueTotal')
}

/**
 * Summary strip above the deals table. It receives the count and revenue of the
 * table's own filtered query (getDealTableData) instead of querying on its own,
 * so the cards and the table always describe the same deals.
 */
export default function DashboardSummary({
  count,
  revenue,
  rawFilter,
  locale = 'he',
}: {
  count: number | string
  revenue: number
  rawFilter: { dateRange?: string; saleDtRange?: string } | null | undefined
  /** The page's interface language (server-resolved); Hebrew by default. Amounts stay ILS: deals have no currency. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <div className='mb-6'>
      <div className='flex gap-4 mobile:grid grid-cols-2 mb-6'>
        <StatCard title={revenueLabel(rawFilter, locale)} value={formatCurrency(revenue)} />
        <StatCard title={t('deals.page.summary.dealsTotal')} value={Number(count) || 0} />
      </div>
    </div>
  )
}

function StatCard({ title, value, href = null }: { title: string; value: string | number; href?: string | null }) {
  const card = (
    <div className='num-box'>
      <span>{title}</span>
      <h2>{value}</h2>
    </div>
  )

  if (href) return <Link href={href}>{card}</Link>
  return card
}
