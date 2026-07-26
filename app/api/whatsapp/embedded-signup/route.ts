import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { GRAPH_BASE as GRAPH } from '@/lib/facebook/graph'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'
import { track } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'

/**
 * Return a structured failure WITHOUT persisting an operational connection.
 * The client maps `error` to an approved notice; `reason` is the precise code
 * for analytics. This is the guard that stops a failed setup masquerading as a
 * connected WhatsApp number (the Oren 2026-07-21 incident).
 */
function fail(agencyId: number, userId: number, reason: WaReason, stage: string, status = 400) {
  track({
    agencyId,
    userId,
    event: 'whatsapp_connect_failed',
    props: { reason, stage },
  })
  return NextResponse.json({ ok: false, error: WA_REASON_NOTICE_CODE[reason], reason }, { status })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agencyId = user.agencyId!

  let body: { code?: string; wabaId?: string; phoneNumberId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { code, wabaId, phoneNumberId } = body
  if (!code || !phoneNumberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  // A WABA id is required to subscribe the app for inbound messages. Without it
  // the connection could never receive leads, so we refuse to persist one.
  if (!wabaId) {
    return fail(agencyId, user.id, WA_REASON.WABA_NOT_FOUND, 'discover', 400)
  }

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  // 1. Exchange the OAuth code for an access token.
  let accessToken: string
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`)
    if (!res.ok) {
      console.error('[WA EmbeddedSignup] token exchange failed:', res.status, await res.text())
      return fail(agencyId, user.id, WA_REASON.TOKEN_EXCHANGE_FAILED, 'token', 400)
    }
    const data = await res.json()
    accessToken = data.access_token
    if (!accessToken) return fail(agencyId, user.id, WA_REASON.TOKEN_EXCHANGE_FAILED, 'token', 400)
  } catch (e) {
    console.error('[WA EmbeddedSignup] token exchange threw:', e)
    return fail(agencyId, user.id, WA_REASON.TOKEN_EXCHANGE_FAILED, 'token', 400)
  }

  // 2. Cross-tenant safety: never silently move a phone number between agencies.
  //    Same agency reconnecting is allowed (updates token/waba below).
  const existing = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first()
  if (existing && existing.agency_id !== agencyId) {
    console.warn('[WA EmbeddedSignup] cross-tenant claim rejected', {
      phoneNumberId,
      requestingAgency: agencyId,
      // NOTE: the owning agency id/name is deliberately NOT returned to the client.
    })
    return fail(agencyId, user.id, WA_REASON.RESOURCE_CLAIMED, 'ownership', 409)
  }

  // 3. Subscribe the app to the WABA. This is the webhook subscription that lets
  //    inbound messages/leads reach SocialCRM. It MUST succeed before we persist
  //    a connection — a saved-but-unsubscribed row is a false "connected" state.
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      console.error('[WA EmbeddedSignup] subscribed_apps failed:', res.status, await res.text())
      return fail(agencyId, user.id, WA_REASON.SUBSCRIBED_APPS_FAILED, 'subscribe', 502)
    }
  } catch (e) {
    console.error('[WA EmbeddedSignup] subscribed_apps threw:', e)
    return fail(agencyId, user.id, WA_REASON.SUBSCRIBED_APPS_FAILED, 'subscribe', 502)
  }

  track({ agencyId, userId: user.id, event: 'whatsapp_webhook_subscribed', props: {} })

  // 4. Subscription confirmed — now safe to persist the connection.
  try {
    await db('whatsapp_connections')
      .insert({
        user_id: user.id,
        agency_id: agencyId,
        phone_number_id: phoneNumberId,
        access_token: accessToken,
        waba_id: wabaId,
      })
      .onConflict('phone_number_id')
      .merge({
        user_id: user.id,
        agency_id: agencyId,
        access_token: accessToken,
        waba_id: wabaId,
      })
  } catch (err) {
    console.error('[WA EmbeddedSignup] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // 5. Readiness is a softer, separate state: the connection is subscribed, but
  //    Meta may not have registered the number for send/receive yet. We persist
  //    the (subscribed) connection and report readiness honestly — the settings
  //    UI shows "setup incomplete" until the number is CONNECTED.
  const readiness = await ensureMessagingReady(phoneNumberId, accessToken)

  if (readiness.ready) {
    track({ agencyId, userId: user.id, event: 'whatsapp_messaging_ready', props: {} })
    track({ agencyId, userId: user.id, event: 'whatsapp_connected_operational', props: {} })
  } else {
    track({
      agencyId,
      userId: user.id,
      event: 'whatsapp_connect_failed',
      props: { reason: WA_REASON.PHONE_NOT_READY, stage: 'readiness' },
    })
  }

  return NextResponse.json({ ok: true, messagingReady: readiness.ready, reason: readiness.reason })
}
