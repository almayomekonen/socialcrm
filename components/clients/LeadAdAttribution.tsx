import Link from 'next/link'
import { getUser } from '@/db/auth'
import { getLeadAdAttribution } from '@/db/adsCrmOutcomes'
import { readCreativeForAd } from '@/db/adsSnapshots'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { isAdObjectId } from '@/lib/facebook/ads/insights'
import type { AdCreative } from '@/lib/facebook/ads/creatives'
import { isAdmin, type Roles } from '@/types/roles'
import AdThumb from './AdThumb'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * "הגיע ממודעה ב-Meta" — one compact line on the lead page, only for a lead
 * whose `lead_attribution` row carries what Meta put on it. Nothing is guessed:
 * a lead without that row shows nothing here.
 *
 * TENANCY: the attribution is read with the SESSION's agency, so this line can
 * never show another agency's data whatever lead id the URL names.
 * The creative thumbnail comes from the report's cache only — no Graph call on
 * a lead page. The campaign links into the ads report for those who can open it.
 */
export default async function LeadAdAttribution({ leadId, locale = 'he' }: { leadId: number; locale?: UiLocale }) {
  const user = await getUser()
  if (!user?.agencyId) return null
  const a = await getLeadAdAttribution(user.agencyId, leadId).catch(() => null)
  if (!a) return null
  if (!a.campaignName && !a.adName && !a.adsetName && a.isOrganic !== true) return null

  const creative =
    a.adId && isAdObjectId(a.adId) ? await readCreativeForAd<AdCreative>(user.agencyId, a.adId).catch(() => null) : null
  const canOpenReport = isFacebookAdsReportingEnabledForAgency(user.agencyId) && isAdmin(user.role as Roles)
  const t = translatorFor(locale)
  const platform = a.platform === 'ig' ? t('leadDetail.ad.platform.ig') : a.platform === 'fb' ? t('leadDetail.ad.platform.fb') : null

  // Campaign / ad set / ad names are Meta data, shown as Meta returns them.
  return (
    <div className='mb-4 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2' {...regionAttrs(locale)}>
      {creative?.payload.imageUrl && <AdThumb url={creative.payload.imageUrl} />}
      <div className='min-w-0 text-sm'>
        <p className='text-xs text-gray-500'>
          {a.isOrganic ? t('leadDetail.ad.organic') : t('leadDetail.ad.paid')}
          {platform ? ` · ${platform}` : ''}
        </p>
        <p className='truncate text-gray-800'>
          {a.campaignName &&
            (canOpenReport && a.campaignId && isAdObjectId(a.campaignId) ? (
              <Link href={`/sum_sales/ads?campaign=${a.campaignId}`} className='text-primary underline underline-offset-2'>
                {a.campaignName}
              </Link>
            ) : (
              <span>{a.campaignName}</span>
            ))}
          {a.adsetName && <span className='text-gray-500'> · {a.adsetName}</span>}
          {a.adName && <span className='text-gray-500'> · {a.adName}</span>}
        </p>
      </div>
    </div>
  )
}
