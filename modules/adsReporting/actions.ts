'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { deleteAdConnection } from '@/db/facebookAds'

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
