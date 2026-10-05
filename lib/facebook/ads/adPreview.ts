import 'server-only'
import { graphRequest } from '@/lib/facebook/graphClient'
import { ADS_API_VERSION } from '@/lib/facebook/ads/apiVersion'
import { adsFail, isAdAccountId, isAdObjectId, listAdAccounts } from '@/lib/facebook/ads/insights'
import { getAdConnection } from '@/db/facebookAds'

/**
 * Meta's own preview of one ad, so a video ad can be watched inside SocialCRM.
 *
 * Documented `ads_read` read (Ad Previews reference, checked 2026-10-05):
 *   GET /{ad id}/previews?ad_format=MOBILE_FEED_STANDARD
 * returns `{ data: [{ body: '<iframe src="https://…/ads/api/preview_iframe.php?d=…&t=…" …>' }] }`.
 * Meta: "The API returns an iframe, which is only valid for 24 hours" — so the
 * URL is fetched on click and never stored.
 *
 * THE BROWSER NEVER SEES META'S HTML. Only the iframe `src` is extracted, and only
 * if it is an https URL on www/business.facebook.com, at exactly
 * /ads/api/preview_iframe.php, carrying nothing but Meta's `d` (preview payload)
 * and `t` (signature) parameters. Neither is the access token, which stays in the
 * Authorization header of the server-side request.
 *
 * TENANCY. The ad must belong to the connection's remembered account, and that
 * account must be one Meta lists for this connection's own token — the same
 * re-check the report page does. An ad id from another account (or agency) is
 * refused before its preview is requested.
 */

export const PREVIEW_HOSTS = new Set(['www.facebook.com', 'business.facebook.com'])
export const PREVIEW_PATH = '/ads/api/preview_iframe.php'
const PREVIEW_PARAMS = new Set(['d', 't'])
export const PREVIEW_FORMAT = 'MOBILE_FEED_STANDARD'

/** Meta's preview HTML → a validated preview URL, or null. Pure. */
export function previewUrlFromHtml(html: unknown): string | null {
  if (typeof html !== 'string' || html.length > 20000) return null
  const match = /<iframe\b[^>]*?\ssrc="([^"<>]+)"/i.exec(html)
  if (!match) return null
  // The only entity Meta uses inside the attribute is &amp; between parameters.
  const raw = match[1].replace(/&amp;/g, '&')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null
  if (!PREVIEW_HOSTS.has(url.hostname) || url.pathname !== PREVIEW_PATH) return null
  const keys = [...url.searchParams.keys()]
  if (keys.length === 0 || keys.some((k) => !PREVIEW_PARAMS.has(k)) || !url.searchParams.get('d')) return null
  return url.toString()
}

/** Is this ad in that account? `account_id` comes back without the `act_` prefix. */
async function adBelongsTo(token: string, adId: string, accountId: string): Promise<boolean | null> {
  const res = await graphRequest<{ account_id?: unknown }>({
    path: `/${adId}`,
    token,
    query: { fields: 'account_id' },
    version: ADS_API_VERSION,
  })
  if ('error' in res) {
    adsFail(res.error, 'ad preview ownership')
    return null
  }
  return typeof res.data.account_id === 'string' && `act_${res.data.account_id}` === accountId
}

export type AdPreviewResult = { ok: true; url: string } | { ok: false }

/**
 * The preview for one ad, for this user's own ad connection. Never throws.
 * agencyId/userId come from the session (the server action), never the browser.
 */
export async function loadAdPreview(agencyId: number, userId: number, adId: unknown): Promise<AdPreviewResult> {
  if (typeof adId !== 'string' || !isAdObjectId(adId)) return { ok: false }
  try {
    const connection = await getAdConnection(agencyId, userId)
    if (!connection || !connection.grantedScopes.includes('ads_read')) return { ok: false }
    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) return { ok: false }
    const accountId = connection.selectedAccountId
    if (!accountId || !isAdAccountId(accountId)) return { ok: false }

    const listed = await listAdAccounts(connection.token)
    if ('reason' in listed || !listed.value.some((a) => a.id === accountId)) return { ok: false }
    if ((await adBelongsTo(connection.token, adId, accountId)) !== true) return { ok: false }

    const res = await graphRequest<{ data?: { body?: unknown }[] }>({
      path: `/${adId}/previews`,
      token: connection.token,
      query: { ad_format: PREVIEW_FORMAT },
      version: ADS_API_VERSION,
    })
    if ('error' in res) {
      adsFail(res.error, 'ad preview')
      return { ok: false }
    }
    const url = previewUrlFromHtml(res.data.data?.[0]?.body)
    if (!url) {
      console.warn('[AdsReporting] ad preview failed', { reason: 'unexpected_preview_shape' })
      return { ok: false }
    }
    return { ok: true, url }
  } catch (err) {
    console.warn('[AdsReporting] ad preview failed', { reason: err instanceof Error ? err.name : 'unknown' })
    return { ok: false }
  }
}
