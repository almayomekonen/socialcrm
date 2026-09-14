import { db } from '@/config/db'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { pageWebhookFields } from '@/lib/facebook/pageWebhookFields'
import { subscribePageWebhooks } from '@/lib/facebook/pageSubscription'
import { sealPageAccessToken } from '@/lib/facebook/pageToken'

/**
 * Reconnect = refresh the Pages this agency ALREADY owns, server-side.
 *
 * THE BUG THIS CLOSES. A reconnect walked the user through Meta's consent
 * screen, then landed on a settings screen that — because a connection already
 * existed — never rendered the Page picker, so the fresh token and the newly
 * granted permissions were dropped on the floor. A Page connected before a
 * permission was requested could therefore never gain it.
 *
 * SCOPE. Only rows that are (a) in this agency, (b) connected by THIS CRM user,
 * and (c) among the Pages Meta just returned for the consenting Facebook user
 * are touched, matched by Page id. A Page owned by another agency cannot be
 * written. A Page another admin of the same agency connected is left to the
 * normal picker, exactly as before — the settings screens decide "connected"
 * per user, so silently refreshing it would leave this admin at a dead end.
 *
 * The token is refreshed even when the re-subscribe is refused (e.g. Meta
 * rejects a Messenger field): Meta keeps the previous subscription on failure,
 * so Lead Ads keep flowing, and a fresh token is never worse than a stale one.
 */
export async function refreshConnectedPages(input: {
  agencyId: number
  userId: number
  pages: { id: string; name: string; access_token: string }[]
  grantedScopes: string[]
}): Promise<{ refreshed: number; subscribeFailed: number }> {
  const byId = new Map(input.pages.filter((p) => p?.id && p.access_token).map((p) => [p.id, p]))
  if (byId.size === 0) return { refreshed: 0, subscribeFailed: 0 }

  const rows = (await db('facebook_pages')
    .where({ agency_id: input.agencyId, user_id: input.userId })
    .whereIn('page_id', [...byId.keys()])
    .select('id', 'page_id', 'health_status')) as { id: number; page_id: string; health_status: string }[]

  const fields = pageWebhookFields({
    grantedScopes: input.grantedScopes,
    messengerEnabled: isFacebookMessengerEnabledForAgency(input.agencyId),
  })

  let refreshed = 0
  let subscribeFailed = 0
  for (const row of rows) {
    const page = byId.get(row.page_id)
    if (!page) continue
    // Sealed first: if the token cannot be protected, nothing at Meta changes either.
    const sealed = sealPageAccessToken(page.access_token)
    const sub = await subscribePageWebhooks(row.page_id, page.access_token, fields)
    if (!sub.ok) subscribeFailed++
    await db('facebook_pages')
      .where({ id: row.id, agency_id: input.agencyId })
      .update({
        page_access_token: sealed,
        page_name: page.name || undefined,
        granted_scopes: JSON.stringify(input.grantedScopes),
        health_status: sub.ok ? 'healthy' : row.health_status,
        health_checked_at: new Date(),
      })
    refreshed++
  }
  return { refreshed, subscribeFailed }
}
