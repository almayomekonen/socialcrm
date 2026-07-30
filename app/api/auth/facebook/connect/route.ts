import { NextRequest, NextResponse, after } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { emitLifecycleEvent } from '@/lib/events/emit'
import { track } from '@/lib/analytics/track'
import { FB_REASON, FB_REASON_NOTICE_CODE } from '@/lib/connections/reasons'
import { sendFacebookConnectedLeadOnce } from '@/lib/facebook/metaLeadConversion'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agencyId = user.agencyId!

  let body: { pageId: string; pageName: string; pageAccessToken: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { pageId, pageName, pageAccessToken } = body
  if (!pageId || !pageName || !pageAccessToken) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
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

  // FIX 2: Subscribe BEFORE saving to DB — if subscription fails, do not save and return error.
  // Without a working subscription Meta will never fire leadgen webhooks for this page,
  // so a saved-but-unsubscribed connection is worse than no connection at all.
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      body: new URLSearchParams({
        access_token: pageAccessToken,
        subscribed_fields: 'leadgen',
      }),
    })
    if (!res.ok) {
      console.error(`[FacebookConnect] Page subscription failed [pageId=${pageId}]:`, await res.text())
      track({ agencyId, userId: user.id, event: 'facebook_connect_failed', props: { reason: FB_REASON.PAGE_SUBSCRIPTION_FAILED, stage: 'subscribe' } })
      return NextResponse.json({ error: 'subscription_failed' }, { status: 502 })
    }
    console.log(`[FacebookConnect] Page subscribed to leadgen [pageId=${pageId}]`)

    // Verify subscription is active
    try {
      const verifyRes = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps?access_token=${pageAccessToken}`,
      )
      const verifyData = await verifyRes.json()
      console.log(`[FacebookConnect] Active subscriptions [pageId=${pageId}]:`, JSON.stringify(verifyData))
    } catch (verifyErr) {
      console.warn(`[FacebookConnect] Subscription verify threw [pageId=${pageId}]:`, verifyErr)
    }
  } catch (err) {
    console.error(`[FacebookConnect] Page subscription threw [pageId=${pageId}]:`, err)
    track({ agencyId, userId: user.id, event: 'facebook_connect_failed', props: { reason: FB_REASON.PAGE_SUBSCRIPTION_FAILED, stage: 'subscribe' } })
    return NextResponse.json({ error: 'subscription_failed' }, { status: 502 })
  }

  track({ agencyId, userId: user.id, event: 'facebook_webhook_subscribed', props: {} })

  // Subscription confirmed — now safe to upsert by page_id
  try {
    await db('facebook_pages')
      .insert({
        user_id: user.id,
        agency_id: user.agencyId,
        page_id: pageId,
        page_name: pageName,
        page_access_token: pageAccessToken,
      })
      .onConflict('page_id')
      .merge({
        user_id: user.id,
        agency_id: user.agencyId,
        page_name: pageName,
        page_access_token: pageAccessToken,
      })
  } catch (err) {
    console.error('[FacebookConnect] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Clear the pending pages cookie
  const cookieStore = await cookies()
  cookieStore.delete('fb_pages')

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
