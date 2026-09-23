import { GRAPH_BASE } from '@/lib/facebook/graph'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { pageEssentialFieldList, pageWebhookFields } from '@/lib/facebook/pageWebhookFields'
import { parseGrantedScopes } from '@/db/facebook'

/**
 * POST /{page-id}/subscribed_apps — the call Lead Ads intake depends on.
 *
 * One implementation for connect, reconnect and the hourly repair, so the
 * three can never disagree about which fields a Page needs (a repair that
 * re-sent only `leadgen,feed` would silently unsubscribe Messenger).
 *
 * The wire format is the one already proven in production: form-encoded body,
 * token in the BODY (never the URL). Only the field list is now computed per
 * Page instead of being a constant.
 */
export async function subscribePageWebhooks(
  pageId: string,
  pageAccessToken: string,
  fields: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetchImpl(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`, {
      method: 'POST',
      body: new URLSearchParams({ access_token: pageAccessToken, subscribed_fields: fields }),
    })
    const data = (await res.json().catch(() => null)) as { success?: unknown } | null
    return { ok: res.ok && data?.success !== false, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

/** The field set a stored Page row needs, from its recorded grant and the agency's rollout. */
export function fieldsForPageRow(row: { agency_id: number; granted_scopes: unknown }): string {
  return pageWebhookFields({
    grantedScopes: parseGrantedScopes(row.granted_scopes),
    messengerEnabled: isFacebookMessengerEnabledForAgency(row.agency_id),
  })
}

/**
 * The fields whose absence means this Page's Messenger is BROKEN — the set the
 * readiness verdict judges against. See pageEssentialFieldList.
 */
export function essentialFieldsForPageRow(row: { agency_id: number; granted_scopes: unknown }): string {
  return pageEssentialFieldList({
    grantedScopes: parseGrantedScopes(row.granted_scopes),
    messengerEnabled: isFacebookMessengerEnabledForAgency(row.agency_id),
  }).join(',')
}
