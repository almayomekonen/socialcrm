import ConnectionNotice from '@/components/settings/ConnectionNotice'
import { formatAdsPeriod } from '@/lib/facebook/ads/format'
import { attributionLabel } from '@/lib/facebook/ads/results'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { noticeReasonsLabel } from '@/lib/inbox/whatsappComposerDecision'
import type { AdsReport } from '@/lib/facebook/ads/report'
import type { AdsBreakdown } from '@/lib/facebook/ads/breakdown'
import type { AdsResult } from '@/lib/facebook/ads/insights'
import { CLEAR_ADSET, CLEAR_DRILLDOWN } from '@/lib/facebook/ads/selection'
import { FAILURE_NOTICE, adsNotice } from '@/modules/adsReporting/notices'
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
  locale = 'he',
}: {
  report: AdsReport & { totals: NonNullable<AdsReport['totals']> }
  breakdown: AdsResult<AdsBreakdown> | null
  account: { name: string; currency: string | null; timezone: string | null }
  /** Meta ↔ SocialCRM sections; absent → the report renders exactly as before. */
  intel?: AdsIntelligenceData | null
  /** The page's interface language (server-resolved); Hebrew by default. Meta's numbers and names are shown as returned. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const { totals, previous, campaigns } = report
  const attribution = attributionLabel(totals.attribution, locale)
  // Per-box comparison only when the previous period had delivery; otherwise the context line says why.
  const comparedTotals = previous && typeof previous === 'object' && previous.totals ? previous.totals : undefined
  const showLeads = (totals.leads ?? 0) > 0 || campaigns.some((c) => c.result.kind === 'leads')

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <dl className='flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600'>
        {report.period && (
          <div className='flex gap-1'>
            <dt>{t('performance.ads.context.period')}</dt>
            <dd dir='ltr'>{formatAdsPeriod(report.period)}</dd>
          </div>
        )}
        <div className='flex gap-1'>
          <dt>{t('performance.ads.context.timezone')}</dt>
          <dd dir='ltr'>{account.timezone ?? '—'}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>{t('performance.ads.context.currency')}</dt>
          <dd dir='ltr'>{account.currency ?? '—'}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>{t('performance.ads.context.attribution')}</dt>
          <dd>{attribution ?? t('performance.ads.context.attributionUnknown')}</dd>
        </div>
        <div className='flex gap-1'>
          <dt>{t('performance.ads.context.compare')}</dt>
          <dd>
            {previous === 'unavailable' ? (
              t('performance.ads.context.compareUnavailable')
            ) : previous === 'partial' ? (
              t('performance.ads.context.comparePartial')
            ) : previous ? (
              <>
                <span dir='ltr'>{formatAdsPeriod(previous.period)}</span>
                {previous.totals ? '' : t('performance.ads.context.compareNoActivity')}
              </>
            ) : (
              t('performance.ads.context.compareNone')
            )}
          </dd>
        </div>
      </dl>

      {report.reducedFields && (
        <p className='text-sm text-gray-600'>{t('performance.ads.context.reducedFields')}</p>
      )}

      <AdsSummaryCards totals={totals} previous={comparedTotals} campaigns={campaigns} currency={account.currency} locale={locale} />

      {intel && <AdsIntelligence data={intel} campaigns={campaigns} breakdown={breakdown} currency={account.currency} locale={locale} />}

      <AdsDailyTrend daily={report.daily} currency={account.currency} showLeads={showLeads} locale={locale} />

      {breakdown === null ? (
        <AdsResultsTable
          title={t('performance.ads.table.campaigns')}
          nameHeader={t('performance.ads.table.campaign')}
          rows={campaigns}
          currency={account.currency}
          statusesAvailable={report.statusesAvailable}
          emptyText={t('performance.ads.table.noCampaigns')}
          drill={{ label: t('performance.ads.table.adsetsLink'), to: (row) => ({ campaign: row.id }) }}
          locale={locale}
        />
      ) : 'reason' in breakdown ? (
        <div className='grid max-w-2xl gap-2'>
          <ConnectionNotice
            notice={adsNotice(FAILURE_NOTICE[breakdown.reason], locale)}
            {...(locale === 'he' ? {} : { reasonsLabel: noticeReasonsLabel(locale) })}
          />
          <div className='flex flex-wrap gap-3'>
            <AdsRetryButton />
            <AdsDrillLink to={CLEAR_DRILLDOWN}>{t('performance.ads.table.backToCampaigns')}</AdsDrillLink>
          </div>
        </div>
      ) : (
        <div className='grid gap-3'>
          <nav aria-label={t('performance.ads.table.breadcrumb')} className='flex flex-wrap items-center gap-2 text-sm text-gray-600'>
            <AdsDrillLink to={CLEAR_DRILLDOWN}>{t('performance.ads.table.allCampaigns')}</AdsDrillLink>
            <span aria-hidden='true'>›</span>
            {breakdown.value.adset ? (
              <>
                <AdsDrillLink to={CLEAR_ADSET}>{breakdown.value.campaign.name ?? t('performance.ads.table.theCampaign')}</AdsDrillLink>
                <span aria-hidden='true'>›</span>
                <span className='font-medium text-gray-900'>{breakdown.value.adset.name ?? t('performance.ads.table.theAdset')}</span>
              </>
            ) : (
              <span className='font-medium text-gray-900'>{breakdown.value.campaign.name ?? t('performance.ads.table.theCampaign')}</span>
            )}
          </nav>
          <AdsResultsTable
            title={breakdown.value.level === 'adset' ? t('performance.ads.table.adsets') : t('performance.ads.table.adsOfAdset')}
            nameHeader={breakdown.value.level === 'adset' ? t('performance.ads.table.adset') : t('performance.ads.table.ad')}
            rows={breakdown.value.rows}
            currency={account.currency}
            statusesAvailable={breakdown.value.statusesAvailable}
            emptyText={t('performance.ads.table.noLevel')}
            drill={breakdown.value.level === 'adset' ? { label: t('performance.ads.table.adsLink'), to: (row) => ({ adset: row.id }) } : undefined}
            locale={locale}
          />
        </div>
      )}

      <p className='text-xs text-gray-500'>
        {t('performance.ads.context.footnote')}
        {intel && t('performance.ads.context.footnoteCrm')}
      </p>
    </div>
  )
}
