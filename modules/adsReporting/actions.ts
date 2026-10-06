'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { deleteAdConnection } from '@/db/facebookAds'
import { isAdmin, type Roles } from '@/types/roles'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { loadAdPreview, type AdPreviewResult } from '@/lib/facebook/ads/adPreview'

/**
 * Disconnect ad reporting for the current user: delete the stored token, so
 * SocialCRM can no longer read their ad data.
 *
 * Deliberately NOT a revocation at Meta. `DELETE /me/permissions/ads_read`
 * removes the permission for that Facebook user across the whole app — which
 * would silently break ad reporting for any OTHER SocialCRM user or agency that
 * connected with the same Facebook account. Removing the grant entirely is the
 * user's own action in Facebook → Settings → Business integrations.
 */
export async function disconnectAdsReporting(): Promise<{ ok: true }> {
  const user = await requireAgencyUser()
  await deleteAdConnection(user.agencyId, user.id)
  revalidatePath('/sum_sales/ads')
  return { ok: true }
}

/**
 * Meta's preview of one ad, on demand (a click on a video ad's thumbnail). Same
 * gates as the report page: feature on for this agency, account admin. Agency and
 * user come from the session; the browser sends only the ad id, which
 * loadAdPreview checks against this connection's verified account.
 */
export async function getAdPreview(adId: string): Promise<AdPreviewResult> {
  const user = await requireAgencyUser()
  if (!isFacebookAdsReportingEnabledForAgency(user.agencyId) || !isAdmin(user.role as Roles)) return { ok: false }
  return loadAdPreview(user.agencyId, user.id, adId)
}
