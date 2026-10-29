import { adsStatusLabel, objectiveLabel, type RowResult } from '@/lib/facebook/ads/results'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { CrmOutcome } from '@/lib/facebook/ads/crmOutcomes'
import type { AdsSelectionQuery } from '@/lib/facebook/ads/selection'
import { CrmLine, MetaLine } from './AdsOutcomeLines'
import AdsDrillLink from './AdsDrillLink'

/**
 * Campaigns (or ad sets) as cards: Meta's numbers and what happened to the
 * resulting leads in SocialCRM, side by side and labelled apart. The first
 * screen stays at one level; the hierarchy opens through the drill link.
 */

export type OutcomeCardRow = {
  id: string
  name: string
  status: string | null
  objective?: string | null
  spend: number | null
  result: RowResult
}

export default function AdsCampaignCards({
  title,
  rows,
  outcomes,
  currency,
  drill,
  emptyText,
  locale = 'he',
}: {
  title: string
  rows: OutcomeCardRow[]
  /** SocialCRM outcomes by this level's Meta id. */
  outcomes: Record<string, CrmOutcome>
  currency: string | null
  drill?: { label: string; to: (row: OutcomeCardRow) => AdsSelectionQuery }
  emptyText: string
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  return (
    <section aria-label={title} className='@container/cards grid gap-3'>
      <h2 className='text-base font-semibold text-gray-900'>{title}</h2>
      {rows.length === 0 ? (
        <p className='text-sm text-gray-600'>{emptyText}</p>
      ) : (
        <ul className='grid grid-cols-1 items-start gap-3 @3xl/cards:grid-cols-2'>
          {rows.map((row) => (
            <li key={row.id} className='@container min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-xs'>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <h3 className='truncate text-[15px] font-semibold text-gray-900' title={row.name}>
                    {row.name}
                  </h3>
                  {row.objective && (
                    <p className='text-xs text-gray-500'>{t('performance.ads.table.objective', { objective: objectiveLabel(row.objective, locale) })}</p>
                  )}
                </div>
                {row.status && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      row.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {adsStatusLabel(row.status, locale)}
                  </span>
                )}
              </div>
              <div className='mt-3 grid gap-2'>
                <MetaLine spend={row.spend} result={row.result} currency={currency} locale={locale} />
                <CrmLine outcome={outcomes[row.id]} spend={row.spend} currency={currency} locale={locale} />
              </div>
              {drill && (
                <div className='mt-3 text-sm max-sm:[&_button]:inline-flex max-sm:[&_button]:min-h-11 max-sm:[&_button]:items-center'>
                  <AdsDrillLink to={drill.to(row)}>{drill.label}</AdsDrillLink>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
