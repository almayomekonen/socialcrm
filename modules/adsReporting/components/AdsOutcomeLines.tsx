import { formatAdsCount, formatAdsMoney } from '@/lib/facebook/ads/format'
import { costPerCapturedLead, handledCount, type CrmOutcome } from '@/lib/facebook/ads/crmOutcomes'
import { resultLabel, type RowResult } from '@/lib/facebook/ads/results'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The two kinds of number a campaign or ad card shows, each on its own line
 * with its own source label, so they can never be read as one:
 *
 *   לפי Meta      — spend and Meta's own result count/cost (Marketing API).
 *   ב-SocialCRM   — leads actually captured here with this campaign/ad's id,
 *                   and what happened to them since.
 *
 * "—" means unknown; 0 is a real zero.
 */

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className='min-w-0' title={title}>
      <dt className='text-[11px] text-gray-500'>{label}</dt>
      <dd dir='ltr' className='text-right text-sm font-semibold text-gray-900 tabular-nums'>
        {value}
      </dd>
    </div>
  )
}

export function MetaLine({
  spend,
  result,
  currency,
  locale = 'he',
}: {
  spend: number | null
  result: RowResult
  currency: string | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const label = result.kind ? resultLabel(result.kind, locale) : t('performance.adsIntel.meta.results')
  return (
    <div className='rounded-md bg-gray-50 px-3 py-2'>
      <p className='mb-1 text-[11px] font-medium text-gray-500'>{t('performance.adsIntel.meta.title')}</p>
      <dl className='grid grid-cols-3 gap-2'>
        <Stat label={t('performance.adsIntel.meta.spend')} value={formatAdsMoney(spend, currency)} />
        <Stat label={label} value={result.kind ? formatAdsCount(result.count) : '—'} />
        <Stat
          label={result.kind === 'leads' ? t('performance.adsIntel.meta.costPerLead') : t('performance.adsIntel.meta.costPerResult')}
          value={formatAdsMoney(result.cost, currency)}
          title={t('performance.adsIntel.meta.costTitle')}
        />
      </dl>
    </div>
  )
}

export function CrmLine({
  outcome,
  spend,
  currency,
  locale = 'he',
}: {
  outcome: CrmOutcome | undefined
  /** Meta spend for the same object and period — for the separately labelled CRM cost. */
  spend: number | null
  currency: string | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  if (!outcome || outcome.captured === 0) {
    return (
      <div className='rounded-md border border-dashed border-gray-200 px-3 py-2'>
        <p className='text-[11px] font-medium text-gray-500'>{t('performance.adsIntel.crm.title')}</p>
        <p className='mt-0.5 text-xs text-gray-500'>{t('performance.adsIntel.crm.none')}</p>
      </div>
    )
  }
  const perCaptured = costPerCapturedLead(spend, outcome)
  return (
    <div className='rounded-md border border-primary/15 bg-primary-tint/40 px-3 py-2'>
      <p className='mb-1 text-[11px] font-medium text-primary-text'>{t('performance.adsIntel.crm.title')}</p>
      <dl className='grid grid-cols-3 gap-2 @md:grid-cols-5'>
        <Stat label={t('performance.adsIntel.crm.captured')} value={formatAdsCount(outcome.captured)} />
        <Stat label={t('performance.adsIntel.crm.handled')} value={formatAdsCount(handledCount(outcome))} title={t('performance.adsIntel.crm.handledTitle')} />
        <Stat label={t('performance.adsIntel.crm.untouched')} value={formatAdsCount(outcome.untouched)} title={t('performance.adsIntel.crm.untouchedTitle')} />
        <Stat label={t('performance.adsIntel.crm.interested')} value={formatAdsCount(outcome.interested)} />
        <Stat label={t('performance.adsIntel.crm.closed')} value={formatAdsCount(outcome.closed)} title={t('performance.adsIntel.crm.closedTitle')} />
      </dl>
      {perCaptured !== null && (
        <p className='mt-1.5 text-[11px] text-gray-600'>
          {t('performance.adsIntel.crm.perCaptured')}{' '}
          <span dir='ltr' className='font-medium tabular-nums'>
            {formatAdsMoney(perCaptured, currency)}
          </span>
          <span className='text-gray-400'>{t('performance.adsIntel.crm.perCapturedHint')}</span>
        </p>
      )}
    </div>
  )
}
