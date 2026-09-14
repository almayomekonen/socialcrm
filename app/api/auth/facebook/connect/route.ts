import { NextRequest, NextResponse, after } from 'next/server'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { emitLifecycleEvent } from '@/lib/events/emit'
import { track } from '@/lib/analytics/track'
import { FB_REASON, FB_REASON_NOTICE_CODE } from '@/lib/connections/reasons'
import { sendFacebookConnectedLeadOnce } from '@/lib/facebook/metaLeadConversion'
import { pageWebhookFields } from '@/lib/facebook/pageWebhookFields'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { subscribePageWebhooks } from '@/lib/facebook/pageSubscription'
import { sealPageAccessToken } from '@/lib/facebook/pageToken'
import { PENDING_PAGES_COOKIE, pendingPageToken, readPendingPages } from '@/lib/facebook/pendingPages'

export async function POST(req: NextRequest) {
  // Selecting the Page writes the agency's lead source. Checked before the
  // ownership lookup, the Graph subscribe call and the write.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agencyId = user.agencyId!

  let body: { pageId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const pageId = typeof body?.pageId === 'string' ? body.pageId : ''
  if (!pageId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  /**
   * The Page's token and name come from the server-side `fb_pages` cookie the
   * OAuth callback wrote — NEVER from the request body. The browser only ever
   * received `{ id, name }`, and a token or name it posts is ignored, so a
   * client cannot bind a Page row to a token it chose. The granted permission
   * set rides the same cookie (see below).
   */
  const cookieStore = await cookies()
  const pending = await readPendingPages(cookieStore.get(PENDING_PAGES_COOKIE)?.value, user.id)
  let selected: { name: string; token: string } | null = null
  try {
    selected = pendingPageToken(pending, pageId)
  } catch {
    selected = null
  }
  if (!selected) {
    return NextResponse.json({ error: 'selection_expired' }, { status: 400 })
  }
  const { name: pageName, token: pageAccessToken } = selected

  // Sealed BEFORE the Meta subscribe call: if the token cannot be protected at
  // rest (SECRETS_ENC_KEY missing), nothing is subscribed and nothing is saved,
  // rather than leaving Meta delivering webhooks for a Page with no row.
  let sealedToken: string
  try {
    sealedToken = sealPageAccessToken(pageAccessToken)
  } catch {
    console.error('[FacebookConnect] Page token could not be sealed — SECRETS_ENC_KEY unavailable')
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  // Cross-tenant safety: never let one agency claim a Page already connected by
  // another. Same agency reconnecting is allowed (token/name refresh below).
  const existingPage = await db('facebook_pages').where({ page_id: pageId }).first()
  if (existingPage && existingPage.agency_id !== agencyId) {
    console.warn('[FacebookConnect] cross-tenant claim rejected', { pageId, requestingAgency: agencyId })
    track({ agencyId, userId: user.id, event: 'facebook_connect_failed', props: { reason: FB_REASON.RESOURCE_CLAIMED, stage: 'ownership' } })
    // Distinct 'resource_claimed' notice — the owning agency is never disclosed.
    return NextResponse.json(
      { error: FB_REASON_NOTICE_CODE[FB_REASON.RESOURCE_CLAIMED], reason: FB_REASON.RESOURCE_CLAIMED },
      { status: 409 },
    )
  }

  /**
   * The permissions Meta reported as granted during this OAuth round trip,
   * written by the callback into the same httpOnly cookie as the Page list.
   * Read SERVER-SIDE only — a client can never inflate its own capability set.
   *
   * Fail-closed: a missing, expired or foreign cookie yields `[]`, which means
   * "we do not know", which every capability gate reads as "not granted".
   */
  const grantedScopes: string[] = pending?.grantedScopes ?? []

  // FIX 2: Subscribe BEFORE saving to DB — if subscription fails, do not save and return error.
  // Without a working subscription Meta will never fire leadgen (or feed) webhooks for this
  // page, so a saved-but-unsubscribed connection is worse than no connection at all.
  // Fields are leadgen + feed, plus Messenger fields only when pages_messaging was granted
  // and Messenger is rolled out to this agency (see pageWebhookFields); Meta replaces the set.
  const fields = pageWebhookFields({ grantedScopes, messengerEnabled: isFacebookMessengerEnabledForAgency(agencyId) })
  const subscription = await subscribePageWebhooks(pageId, pageAccessToken, fields)
  if (!subscription.ok) {
    console.error(`[FacebookConnect] Page subscription failed [pageId=${pageId}] status=${subscription.status}`)
    track({ agencyId, userId: user.id, event: 'facebook_connect_failed', props: { reason: FB_REASON.PAGE_SUBSCRIPTION_FAILED, stage: 'subscribe' } })
    return NextResponse.json({ error: 'subscription_failed' }, { status: 502 })
  }
  console.log(`[FacebookConnect] Page subscribed to ${fields} [pageId=${pageId}]`)

  track({ agencyId, userId: user.id, event: 'facebook_webhook_subscribed', props: {} })

  // Subscription confirmed — now safe to upsert by page_id. The token is stored
  // sealed (lib/facebook/pageToken.ts), never as plaintext.
  try {
    await db('facebook_pages')
      .insert({
        user_id: user.id,
        agency_id: user.agencyId,
        page_id: pageId,
        page_name: pageName,
        page_access_token: sealedToken,
        granted_scopes: JSON.stringify(grantedScopes),
      })
      .onConflict('page_id')
      .merge({
        user_id: user.id,
        agency_id: user.agencyId,
        page_name: pageName,
        page_access_token: sealedToken,
        // Reconnect is the ONLY way an already-issued token gains a scope, so a
        // reconnect must overwrite this — that is the whole point of the flow.
        granted_scopes: JSON.stringify(grantedScopes),
      })
  } catch (err) {
    console.error('[FacebookConnect] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Clear the pending pages cookie
  cookieStore.delete(PENDING_PAGES_COOKIE)

  track({ agencyId, userId: user.id, event: 'facebook_page_selected', props: {} })
  track({ agencyId, userId: user.id, event: 'facebook_connected_operational', props: {} })

  after(() =>
    emitLifecycleEvent({
      type: 'user.meta_connected',
      userId: user.id,
      agencyId: user.agencyId!,
      email: user.email,
      channel: 'facebook',
    }),
  )

  // Meta Ads "Lead" conversion — THE authoritative success point: the Page row is
  // committed and the leadgen subscription was confirmed above, so the connection is
  // genuinely persisted and operational. Fires once per agency; see
  // lib/facebook/metaLeadConversion.ts for the two-layer idempotency.
  //
  // Signals are captured here synchronously (cookies/headers are unreadable inside
  // `after()`), with optional chaining because they are match-quality extras that
  // must never throw in the connection's happy path. The send itself runs in
  // `after()`, once the response is already sent, so a Meta outage, timeout, or
  // rejection cannot delay or fail the Facebook connection.
  const metaLeadSignals = {
    clientIp: req.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers?.get('x-real-ip'),
    clientUserAgent: req.headers?.get('user-agent'),
    fbp: cookieStore.get('_fbp')?.value ?? null,
    fbc: cookieStore.get('_fbc')?.value ?? null,
    eventSourceUrl: req.headers?.get('referer'),
  }
  after(() =>
    sendFacebookConnectedLeadOnce({
      agencyId,
      userId: user.id,
      email: user.email,
      ...metaLeadSignals,
    }),
  )

  return NextResponse.json({ ok: true })
}
