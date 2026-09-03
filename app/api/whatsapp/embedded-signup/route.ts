import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
import { db } from '@/config/db'
import { GRAPH_BASE as GRAPH } from '@/lib/facebook/graph'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'
import { track } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'
import {
  resolvePhoneNumberIdForWaba,
  syncSmbAppData,
  fetchPhoneBizAppState,
  resolveOnboardingType,
  type OnboardingType,
} from '@/lib/whatsapp/coexistence'

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
  // The Embedded Signup path is the sibling of /api/auth/whatsapp/connect and
  // writes the same `whatsapp_connections` row, so it carries the same admin
  // boundary. Guarding only the other endpoint would have left this one open.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user
  const agencyId = user.agencyId

  let body: { code?: string; wabaId?: string; phoneNumberId?: string; onboardingType?: OnboardingType }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { code, wabaId } = body
  const browserOnboardingType: OnboardingType = body.onboardingType === 'coexistence' ? 'coexistence' : 'cloud_api'
  // Resolved below when the coexistence event supplied only a WABA id.
  let phoneNumberId = body.phoneNumberId

  if (!code) {
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

  // 1b. Resolve the phone number when the flow did not hand us one.
  //     Meta documents `waba_id` on the coexistence completion event; a
  //     `phone_number_id` is not guaranteed to accompany it. Previously the
  //     request was rejected outright here, so a customer who completed Meta's
  //     flow correctly still finished unconnected. Needs the token, so it runs
  //     after the exchange.
  if (!phoneNumberId) {
    const resolution = await resolvePhoneNumberIdForWaba(wabaId, accessToken)
    if (!resolution.phoneNumberId) {
      console.error('[WA EmbeddedSignup] could not resolve phone number from WABA', {
        reason: resolution.reason,
        browserOnboardingType,
      })
      return fail(agencyId, user.id, WA_REASON.PHONE_NOT_FOUND, 'discover', 400)
    }
    phoneNumberId = resolution.phoneNumberId
  }

  // Server-side authority: Graph `is_on_biz_app` wins over the browser type.
  const bizApp = await fetchPhoneBizAppState(phoneNumberId, accessToken)
  const onboardingType = resolveOnboardingType({
    isOnBizApp: bizApp.isOnBizApp,
    browserOnboardingType,
  })

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
        onboarding_type: onboardingType,
      })
      .onConflict('phone_number_id')
      .merge({
        user_id: user.id,
        agency_id: agencyId,
        access_token: accessToken,
        waba_id: wabaId,
        onboarding_type: onboardingType,
      })
  } catch (err) {
    console.error('[WA EmbeddedSignup] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // 5. Readiness is a softer, separate state: the connection is subscribed, but
  //    Meta may not have registered the number for send/receive yet. We persist
  //    the (subscribed) connection and report readiness honestly — the settings
  //    UI shows "setup incomplete" until the number is CONNECTED.
  const readiness = await ensureMessagingReady(phoneNumberId, accessToken, {
    skipRegistration: onboardingType === 'coexistence',
  })

  // 5b. Coexistence only: request the one-time contact and message-history sync.
  //     Meta gives 24 hours before the customer must be offboarded and redo the
  //     flow, and the step can only be performed once — so it runs now, inline,
  //     rather than being deferred to a job that might not run in time.
  //     A failure degrades the connection (no imported history); it must never
  //     fail an onboarding that otherwise succeeded.
  if (onboardingType === 'coexistence') {
    const alreadySynced = existing?.onboarding_type === 'coexistence'
    if (alreadySynced) {
      console.log('[WA EmbeddedSignup] coexistence reconnect; smb_app_data already requested', { phoneNumberId })
    } else {
      const sync = await syncSmbAppData(phoneNumberId, accessToken)
      // History being absent is only "incomplete" when it was actually asked
      // for. While the Wave 2A.0 gate holds it is a deliberate omission that
      // PRESERVES the one-time archive, and reporting that as a failure every
      // time would train us to ignore the line that matters.
      const historyFailed = sync.historyRequested && !sync.history
      if (!sync.contacts || historyFailed) {
        console.warn('[WA EmbeddedSignup] coexistence sync incomplete', {
          phoneNumberId,
          contacts: sync.contacts,
          history: sync.history,
          historyRequested: sync.historyRequested,
        })
      }
    }
  }

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
