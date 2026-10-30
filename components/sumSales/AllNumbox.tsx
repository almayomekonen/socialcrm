import { getSaleStats } from '@/db/sumSales'
import { formatCurrency } from '@/lib/funcs'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Amounts stay ILS in every language: deals have no currency source (claude/i18n.md). */
export default async function AllNumbox({ props, locale = 'he' }: { props: any; locale?: UiLocale }) {
  const { sqlFilter } = props
  const details = await getSaleStats(sqlFilter)

  return (
    <div className='my-8 w-full min-w-0'>
      <ClientsBoxes details={details} locale={locale} />
    </div>
  )
}

function ClientsBoxes({ details, locale }: { details: any; locale: UiLocale }) {
  const t = translatorFor(locale)
  const { hofakCount, inProcessCount, totalRevenue, pipelineValue } = details || {}

  return (
    <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2'>
      <NumboxPrecent title={t('performance.overview.revenuePaid')} num={formatCurrency(totalRevenue)} className='bg-softy border-soft text-solid font-bold' />
      <NumboxPrecent title={t('performance.overview.closedDeals')} num={hofakCount} />
      <NumboxPrecent title={t('performance.overview.pipeline')} num={formatCurrency(pipelineValue)} />
      <NumboxPrecent title={t('performance.overview.inProgress')} num={inProcessCount} />
    </div>
  )
}

function NumboxPrecent({ title, num, className = '', total = null }) {
  if (num === 'NaN' || (typeof num === 'number' && !isFinite(num))) num = 0
  else num = Number(num) || num || 0

  return (
    <div className={`num-box py-6 px-6 ${className}`}>
      <span>{title}</span>
      <div className='flex justify-between *:text-3xl'>
        <h2>{num}</h2>
        {total && <h2>{Number(((num / total) * 100).toFixed(1)) || 0}%</h2>}
      </div>
    </div>
  )
}
