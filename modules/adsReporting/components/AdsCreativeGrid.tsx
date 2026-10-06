import type { RowResult } from '@/lib/facebook/ads/results'
import type { AdCreative } from '@/lib/facebook/ads/creatives'
import type { CrmOutcome } from '@/lib/facebook/ads/crmOutcomes'
import { CrmLine, MetaLine } from './AdsOutcomeLines'
import AdCreativeImage from './AdCreativeImage'
import AdVideoPreview from './AdVideoPreview'

/**
 * Ads as recognisable cards: the creative first, then Meta's numbers and the
 * SocialCRM outcomes of the leads that carry this ad's id. With `videoPreview`,
 * a video ad's thumbnail opens Meta's preview of the ad (image ads stay static).
 */

export type CreativeCardRow = {
  id: string
  name: string
  campaignName?: string | null
  spend: number | null
  result: RowResult
}

export default function AdsCreativeGrid({
  title,
  hint,
  rows,
  creatives,
  outcomes,
  currency,
  videoPreview = false,
}: {
  title: string
  hint?: string
  rows: CreativeCardRow[]
  creatives: Record<string, AdCreative>
  outcomes: Record<string, CrmOutcome>
  currency: string | null
  videoPreview?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <section aria-label={title} className='@container/ads grid gap-3'>
      <div>
        <h2 className='text-base font-semibold text-gray-900'>{title}</h2>
        {hint && <p className='text-xs text-gray-500'>{hint}</p>}
      </div>
      <ul className='grid grid-cols-1 items-start gap-3 @2xl/ads:grid-cols-2 @5xl/ads:grid-cols-3'>
        {rows.map((row) => {
          const creative = creatives[row.id]
          return (
            <li
              key={row.id}
              data-ad-id={row.id}
              className='@container min-w-0 rounded-lg border border-gray-200 bg-white p-3 shadow-xs'
            >
              {videoPreview && creative?.isVideo ? (
                <AdVideoPreview adId={row.id} url={creative.imageUrl} name={row.name} />
              ) : (
                <AdCreativeImage url={creative?.imageUrl ?? null} isVideo={creative?.isVideo ?? false} name={row.name} />
              )}
              <h3 className='mt-2 truncate text-sm font-semibold text-gray-900' title={row.name}>
                {row.name}
              </h3>
              {row.campaignName && <p className='truncate text-xs text-gray-500'>קמפיין: {row.campaignName}</p>}
              <div className='mt-2 grid gap-2'>
                <MetaLine spend={row.spend} result={row.result} currency={currency} />
                <CrmLine outcome={outcomes[row.id]} spend={row.spend} currency={currency} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
