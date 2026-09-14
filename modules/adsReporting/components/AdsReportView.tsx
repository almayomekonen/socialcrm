import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatAdsCount, formatAdsMoney, formatAdsPercent } from '@/lib/facebook/ads/format'
import type { AdsReport } from '@/lib/facebook/ads/insights'

/**
 * Totals (existing `num-box` stat pattern from ביצועים) and the per-campaign
 * table. Every number is Meta's; a metric Meta did not return shows "—".
 */
export default function AdsReportView({
  report,
  currency,
  rangeLabel,
}: {
  report: AdsReport
  currency: string | null
  rangeLabel: string
}) {
  const t = report.totals!
  const boxes = [
    { title: 'הוצאה', value: formatAdsMoney(t.spend, currency), strong: true },
    { title: 'חשיפות', value: formatAdsCount(t.impressions) },
    { title: 'קליקים', value: formatAdsCount(t.clicks) },
    { title: 'אחוז הקלקה (CTR)', value: formatAdsPercent(t.ctr) },
    { title: 'עלות לקליק (CPC)', value: formatAdsMoney(t.cpc, currency) },
  ]

  return (
    <div className='grid gap-6'>
      <div className='flex flex-wrap gap-4 min-w-0 mobile:grid grid-cols-2' aria-label={`סיכום ביצועים — ${rangeLabel}`}>
        {boxes.map((b) => (
          <div key={b.title} className={`num-box py-6 px-6 ${b.strong ? 'bg-softy border-soft text-solid font-bold' : ''}`}>
            <span>{b.title}</span>
            <div className='flex justify-between *:text-3xl'>
              <h2 dir='ltr'>{b.value}</h2>
            </div>
          </div>
        ))}
      </div>

      <section aria-labelledby='ads-campaigns-title' className='rounded-lg border border-gray-200 bg-white'>
        <h2 id='ads-campaigns-title' className='border-b border-gray-100 px-4 py-3 text-base font-semibold text-gray-900'>
          ביצועים לפי קמפיין
        </h2>
        {report.campaigns.length === 0 ? (
          <p className='px-4 py-6 text-sm text-gray-500'>לא נמצאו קמפיינים עם פעילות בטווח הזה.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>קמפיין</TableHead>
                <TableHead>הוצאה</TableHead>
                <TableHead>חשיפות</TableHead>
                <TableHead>קליקים</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>CPC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.campaigns.map((c) => (
                <TableRow key={c.campaignId}>
                  <TableCell className='max-w-72 truncate font-medium'>{c.campaignName}</TableCell>
                  <TableCell dir='ltr' className='tabular-nums'>{formatAdsMoney(c.spend, currency)}</TableCell>
                  <TableCell dir='ltr' className='tabular-nums'>{formatAdsCount(c.impressions)}</TableCell>
                  <TableCell dir='ltr' className='tabular-nums'>{formatAdsCount(c.clicks)}</TableCell>
                  <TableCell dir='ltr' className='tabular-nums'>{formatAdsPercent(c.ctr)}</TableCell>
                  <TableCell dir='ltr' className='tabular-nums'>{formatAdsMoney(c.cpc, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <p className='text-xs text-gray-500'>
        הנתונים נמשכים ישירות מ-Meta ({rangeLabel}), לפי אזור הזמן של חשבון המודעות.
      </p>
    </div>
  )
}
