import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatAdsCount, formatAdsMoney, formatAdsPercent } from '@/lib/facebook/ads/format'
import { OBJECTIVE_LABEL, RESULT_LABEL, STATUS_LABEL, type RowResult } from '@/lib/facebook/ads/results'
import type { AdsMetrics } from '@/lib/facebook/ads/metrics'
import type { AdsSelectionQuery } from '@/lib/facebook/ads/selection'
import AdsDrillLink from './AdsDrillLink'

/**
 * One table for campaigns, ad sets and ads — the same columns at every level so
 * a drill-down reads like the level above it. Each row's result is its own
 * objective's result ("12 לידים", "340 קליקים על קישור"); rows are never summed.
 */

export type AdsTableRow = {
  id: string
  name: string
  objective?: string | null
  status: string | null
  metrics: AdsMetrics
  result: RowResult
}

export default function AdsResultsTable({
  title,
  rows,
  currency,
  nameHeader,
  drill,
  emptyText,
  statusesAvailable,
}: {
  title: string
  rows: AdsTableRow[]
  currency: string | null
  nameHeader: string
  /** The drill-down for a row, if this level has one. */
  drill?: { label: string; to: (row: AdsTableRow) => AdsSelectionQuery }
  emptyText: string
  statusesAvailable: boolean
}) {
  return (
    <section aria-label={title} className='rounded-lg border border-gray-200 bg-white'>
      <h2 className='border-b border-gray-100 px-4 py-3 text-base font-semibold text-gray-900'>{title}</h2>
      {rows.length === 0 ? (
        <p className='px-4 py-6 text-sm text-gray-500'>{emptyText}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{nameHeader}</TableHead>
              <TableHead>הוצאה</TableHead>
              <TableHead>תוצאות</TableHead>
              <TableHead>עלות לתוצאה</TableHead>
              <TableHead>קליקים על קישור</TableHead>
              <TableHead>אחוז הקלקה על קישור</TableHead>
              <TableHead>אנשים שנחשפו</TableHead>
              {drill && <TableHead><span className='sr-only'>פירוט</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='max-w-72'>
                  <div className='truncate font-medium'>{row.name}</div>
                  <div className='text-xs text-gray-500'>
                    {[
                      row.objective ? `מטרה: ${OBJECTIVE_LABEL[row.objective] ?? row.objective}` : null,
                      statusesAvailable ? (row.status ? STATUS_LABEL[row.status] ?? row.status : 'סטטוס לא ידוע') : 'הסטטוס לא נטען',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </TableCell>
                <TableCell dir='ltr' className='tabular-nums'>{formatAdsMoney(row.metrics.spend, currency)}</TableCell>
                <TableCell>
                  {row.result.kind ? (
                    <>
                      <span dir='ltr' className='tabular-nums'>{formatAdsCount(row.result.count)}</span>{' '}
                      <span className='text-xs text-gray-500'>{RESULT_LABEL[row.result.kind]}</span>
                    </>
                  ) : (
                    <span title='לא ניתן לקבוע תוצאה אחת למטרה הזו'>—</span>
                  )}
                </TableCell>
                <TableCell dir='ltr' className='tabular-nums'>
                  {formatAdsMoney(row.result.cost, currency)}
                  {row.result.kind === 'reach' && row.result.cost !== null && <span className='text-xs text-gray-500'> / 1,000</span>}
                </TableCell>
                <TableCell dir='ltr' className='tabular-nums'>{formatAdsCount(row.metrics.linkClicks)}</TableCell>
                <TableCell dir='ltr' className='tabular-nums'>{formatAdsPercent(row.metrics.linkCtr)}</TableCell>
                <TableCell dir='ltr' className='tabular-nums'>{formatAdsCount(row.metrics.reach)}</TableCell>
                {drill && (
                  <TableCell>
                    <AdsDrillLink to={drill.to(row)} label={`${drill.label}: ${row.name}`}>
                      {drill.label}
                    </AdsDrillLink>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
