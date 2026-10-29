import { formatAdsCount, formatAdsPeriod } from '@/lib/facebook/ads/format'
import type { CrmOutcomeGroup } from '@/lib/facebook/ads/crmOutcomes'
import { CrmLine } from './AdsOutcomeLines'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Before an ad account is connected, SocialCRM still knows something true:
 * which Meta campaign every Lead Ads lead came from (the ids and names Meta put
 * on the lead — `lead_attribution`), and what happened to those leads here.
 * Shown as such, with no spend and no Meta counts: those need the ad account.
 */
export default function AdsCrmOnlySection({
  groups,
  period,
  locale = 'he',
}: {
  groups: CrmOutcomeGroup[]
  period: { since: string; until: string }
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  if (groups.length === 0) return null
  const total = groups.reduce((n, g) => n + g.outcome.captured, 0)
  return (
    <section aria-label={t('performance.adsIntel.crmOnly.title')} className='@container/crm grid gap-3'>
      <div>
        <h2 className='text-base font-semibold text-gray-900'>{t('performance.adsIntel.crmOnly.title')}</h2>
        <p className='text-xs text-gray-500'>
          <span dir='ltr'>{formatAdsPeriod(period)}</span> · {t('performance.adsIntel.crmOnly.summary', { count: formatAdsCount(total) })}
        </p>
      </div>
      <ul className='grid grid-cols-1 items-start gap-3 @3xl/crm:grid-cols-2'>
        {groups.map((g) => (
          <li key={g.id} className='@container min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-xs'>
            <h3 className='truncate text-[15px] font-semibold text-gray-900' title={g.name ?? undefined}>
              {g.name ?? t('performance.adsIntel.crmOnly.unnamed')}
            </h3>
            <div className='mt-2'>
              <CrmLine outcome={g.outcome} spend={null} currency={null} locale={locale} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
