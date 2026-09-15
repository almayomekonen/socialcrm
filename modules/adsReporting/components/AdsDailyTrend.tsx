import Icon from '@/lib/Icon'
import { formatAdsCount, formatAdsDay, formatAdsMoney } from '@/lib/facebook/ads/format'
import { DAILY_MAX_DAYS, type AdsReport } from '@/lib/facebook/ads/report'

/**
 * Daily trend, behind a disclosure so the default view stays short. Spend per day
 * with a proportional bar (same bar pattern as the usage meters), link clicks and
 * — when the account has lead campaigns — leads. Per-day reach is deliberately
 * absent: reach is unique per row and cannot be read or summed across days.
 */
export default function AdsDailyTrend({
  daily,
  currency,
  showLeads,
}: {
  daily: AdsReport['daily']
  currency: string | null
  showLeads: boolean
}) {
  if (daily === 'too_long') {
    return <p className='text-sm text-gray-500'>המגמה היומית זמינה לטווחים של עד {DAILY_MAX_DAYS} ימים.</p>
  }
  if (daily === 'unavailable') {
    return <p className='text-sm text-gray-500'>המגמה היומית לא נטענה מ-Meta. שאר הנתונים בדוח תקינים.</p>
  }
  if (daily.length === 0) return null

  const maxSpend = Math.max(0, ...daily.map((d) => d.spend ?? 0))

  return (
    <details className='group/trend rounded-lg border border-gray-200 bg-white'>
      <summary className='flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-base font-semibold text-gray-900 [&::-webkit-details-marker]:hidden'>
        <Icon name='chevron-down' type='reg' className='size-3 bg-gray-700 transition-transform duration-200 group-open/trend:rotate-180' />
        מגמה יומית ({daily.length} ימים)
      </summary>
      <div className='overflow-x-auto border-t border-gray-100'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='text-right text-gray-500'>
              <th className='px-4 py-2 font-medium'>יום</th>
              <th className='px-4 py-2 font-medium'>הוצאה</th>
              <th className='px-4 py-2 font-medium'>קליקים על קישור</th>
              {showLeads && <th className='px-4 py-2 font-medium'>לידים (לפי Meta)</th>}
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date} className='border-t border-gray-100'>
                <td className='px-4 py-1.5 tabular-nums' dir='ltr'>{formatAdsDay(d.date, false)}</td>
                <td className='px-4 py-1.5'>
                  <div className='flex items-center gap-2'>
                    <span dir='ltr' className='w-24 shrink-0 tabular-nums'>{formatAdsMoney(d.spend, currency)}</span>
                    <div className='h-2 w-40 max-w-full overflow-hidden rounded-full bg-gray-100' aria-hidden='true'>
                      <div className='h-full rounded-full bg-solid' style={{ width: `${maxSpend > 0 ? Math.round(((d.spend ?? 0) / maxSpend) * 100) : 0}%` }} />
                    </div>
                  </div>
                </td>
                <td className='px-4 py-1.5 tabular-nums' dir='ltr'>{formatAdsCount(d.linkClicks)}</td>
                {showLeads && <td className='px-4 py-1.5 tabular-nums' dir='ltr'>{formatAdsCount(d.leads)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
