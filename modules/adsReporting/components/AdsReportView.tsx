import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { formatAdsPeriod } from '@/lib/facebook/ads/format'
import { attributionLabel } from '@/lib/facebook/ads/results'
import type { AdsReport } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsResult } from '@/lib/facebook/ads/insights'
import { CLEAR_ADSET, CLEAR_DRILLDOWN } from '@/lib/facebook/ads/selection'
import { ADS_NOTICES, FAILURE_NOTICE } from '@/modules/adsReporting/notices'
import AdsSummaryCards from './AdsSummaryCards'
import AdsResultsTable from './AdsResultsTable'
import AdsDailyTrend from './AdsDailyTrend'
import AdsDrillLink from './AdsDrillLink'
import AdsRetryButton from './AdsRetryButton'
import AdsIntelligence from './AdsIntelligence'
import type { AdsIntelligenceData } from '@/lib/facebook/ads/intelligence'

/**
 * A report with delivery: context line, account summary, daily trend, and either
 * the campaign table or the drill-down (ad sets of a campaign, ads of an ad set).
 * Every number is Meta's; a metric Meta did not return shows "—".
 */
export default function AdsReportView({
  report,
  breakdown,
  account,
  intel = null,
}: {
  report: AdsReport & { totals: NonNullable<AdsReport['totals']> }
  breakdown: AdsResult<AdsBreakdown> | null
  account: { name: string; currency: string | null; timezone: string | null }
  /** Meta ↔ SocialCRM sections; absent → the report renders exactly as before. */
  intel?: AdsIntelligenceData | null
}) {
  const { totals, previous, campaigns } = report
  const attribution = attributionLabel(totals.attribution)
  // Per-box comparison only when the previous period had delivery; otherwise the context line says why.
  const comparedTotals = previous && typeof previous === 'object' && previous.totals ? previous.totals : undefined
  const showLeads = (totals.leads ?? 0) > 0 || campaigns.some((c) => c.result.kind === 'leads')

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <dl className='flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600'>
        {report.period && (
          <div className='flex gap-1'>
            <dt>תקופה:</dt>
            <dd dir='ltr'>{formatAdsPeriod(report.period)}</dd>
          </div>
        )}
        <div className='flex gap-1'>
          <dt>אזור זמן של החשבון:</dt>
          <dd dir='ltr'>{account.timezone ?? '—'}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>מטבע:</dt>
          <dd dir='ltr'>{account.currency ?? '—'}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>ייחוס המרות:</dt>
          <dd>{attribution ?? 'לא דווח על ידי Meta'}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>השוואה:</dt>
          <dd>
            {previous === 'unavailable' ? (
              'ההשוואה לתקופה הקודמת לא נטענה'
            ) : previous === 'partial' ? (
              'לא מוצגת — התקופה כוללת את היום, שעדיין לא הסתיים'
            ) : previous ? (
              <>
                <span dir='ltr'>{formatAdsPeriod(previous.period)}</span>
                {previous.totals ? '' : ' — לא הייתה פעילות בתקופה הזו'}
              </>
            ) : (
              'לא זמינה'
            )}
          </dd>
        </div>
      </dl>

      {report.reducedFields && (
        <p className='text-sm text-gray-600'>Meta לא החזירה חלק מהמדדים המורחבים לחשבון הזה, ולכן מוצגים המדדים הבסיסיים. מדדים חסרים מסומנים ב-—.</p>
      )}

      <AdsSummaryCards totals={totals} previous={comparedTotals} campaigns={campaigns} currency={account.currency} />

      {intel && <AdsIntelligence data={intel} campaigns={campaigns} breakdown={breakdown} currency={account.currency} />}

      <AdsDailyTrend daily={report.daily} currency={account.currency} showLeads={showLeads} />

      {breakdown === null ? (
        <AdsResultsTable
          title='ביצועים לפי קמפיין'
          nameHeader='קמפיין'
          rows={campaigns}
          currency={account.currency}
          statusesAvailable={report.statusesAvailable}
          emptyText='לא נמצאו קמפיינים עם פעילות בטווח הזה.'
          drill={{ label: 'קבוצות מודעות', to: (row) => ({ campaign: row.id }) }}
        />
      ) : 'reason' in breakdown ? (
        <div className='grid max-w-2xl gap-2'>
          <ConnectionNotice notice={ADS_NOTICES[FAILURE_NOTICE[breakdown.reason]]} />
          <div className='flex flex-wrap gap-3'>
            <AdsRetryButton />
            <AdsDrillLink to={CLEAR_DRILLDOWN}>חזרה לכל הקמפיינים</AdsDrillLink>
          </div>
        </div>
      ) : (
        <div className='grid gap-3'>
          <nav aria-label='מיקום בדוח' className='flex flex-wrap items-center gap-2 text-sm text-gray-600'>
            <AdsDrillLink to={CLEAR_DRILLDOWN}>כל הקמפיינים</AdsDrillLink>
            <span aria-hidden='true'>›</span>
            {breakdown.value.adset ? (
              <>
                <AdsDrillLink to={CLEAR_ADSET}>{breakdown.value.campaign.name ?? 'הקמפיין'}</AdsDrillLink>
                <span aria-hidden='true'>›</span>
                <span className='font-medium text-gray-900'>{breakdown.value.adset.name ?? 'קבוצת המודעות'}</span>
              </>
            ) : (
              <span className='font-medium text-gray-900'>{breakdown.value.campaign.name ?? 'הקמפיין'}</span>
            )}
          </nav>
          <AdsResultsTable
            title={breakdown.value.level === 'adset' ? 'קבוצות מודעות בקמפיין' : 'מודעות בקבוצת המודעות'}
            nameHeader={breakdown.value.level === 'adset' ? 'קבוצת מודעות' : 'מודעה'}
            rows={breakdown.value.rows}
            currency={account.currency}
            statusesAvailable={breakdown.value.statusesAvailable}
            emptyText='לא נמצאה פעילות ברמה הזו בטווח התאריכים שנבחר.'
            drill={breakdown.value.level === 'adset' ? { label: 'מודעות', to: (row) => ({ adset: row.id }) } : undefined}
          />
        </div>
      )}

      <p className='text-xs text-gray-500'>
        הנתונים נמשכים ישירות מ-Meta. לידים ורכישות הם המרות ש-Meta מייחסת למודעות לפי הגדרות הייחוס שלה — לא לידים או מכירות
        שאומתו ב-SocialCRM. קליקים על קישור נספרים לפי חלון של יום אחד מקליק. נתונים מהיממה האחרונה עשויים להשתנות.
        {intel && ' המספרים תחת "ב-SocialCRM" הם לידים שנקלטו כאן עם מזהה הקמפיין או המודעה מ-Meta, לפי היום שבו Meta יצרה אותם.'}
      </p>
    </div>
  )
}
