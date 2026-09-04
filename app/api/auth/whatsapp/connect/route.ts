import { NextRequest, NextResponse, after } from 'next/server'
import { decrypt } from '@/db/auth'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { emitLifecycleEvent } from '@/lib/events/emit'
import { GRAPH_BASE as GRAPH } from '@/lib/facebook/graph'
import { track, trackOncePerAgency } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'

function fail(agencyId: number, userId: number, reason: WaReason, stage: string, status = 400) {
  track({ agencyId, userId, event: 'whatsapp_connect_failed', props: { reason, stage } })
  return NextResponse.json({ ok: false, error: WA_REASON_NOTICE_CODE[reason], reason }, { status })
}

export async function POST(req: NextRequest) {
  // Connecting a number is agency configuration: the resulting row serves every
  // user in the tenant. Checked before the Graph calls and before any write.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user
  const agencyId = user.agencyId

  let body: { phoneNumberId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { phoneNumberId } = body
  if (!phoneNumberId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Resolve the access token server-side from the encrypted wa_phones cookie.
  // The token never transits browser JS — the client only sends the selected id.
  const cookieStore = await cookies()
  const waPhonesCookie = cookieStore.get('wa_phones')?.value
  if (!waPhonesCookie) return NextResponse.json({ error: 'No pending connection' }, { status: 400 })

  let accessToken: string | undefined
  let wabaId: string | undefined
  try {
    const payload = await decrypt(waPhonesCookie)
    if (payload?.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const phones = (payload.phones ?? []) as { id: string; accessToken: string; wabaId?: string }[]
    const selected = phones.find((p) => p.id === phoneNumberId)
    accessToken = selected?.accessToken
    wabaId = selected?.wabaId
  } catch {
    return NextResponse.json({ error: 'Invalid pending connection' }, { status: 400 })
  }
  if (!accessToken) return NextResponse.json({ error: 'Phone not found in pending connection' }, { status: 400 })
  if (!wabaId) return fail(agencyId, user.id, WA_REASON.WABA_NOT_FOUND, 'discover', 400)

  // Cross-tenant safety: never silently move a phone number between agencies.
  const existing = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first()
  if (existing && existing.agency_id !== agencyId) {
    console.warn('[WhatsappConnect] cross-tenant claim rejected', { phoneNumberId, requestingAgency: agencyId })
    return fail(agencyId, user.id, WA_REASON.RESOURCE_CLAIMED, 'ownership', 409)
  }

  // Subscribe the app to the WABA BEFORE persisting — a saved-but-unsubscribed
  // row is a false "connected" state that can never receive inbound leads.
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      console.error('[WhatsappConnect] subscribed_apps failed:', res.status, await res.text())
      return fail(agencyId, user.id, WA_REASON.SUBSCRIBED_APPS_FAILED, 'subscribe', 502)
    }
  } catch (e) {
    console.error('[WhatsappConnect] subscribed_apps threw:', e)
    return fail(agencyId, user.id, WA_REASON.SUBSCRIBED_APPS_FAILED, 'subscribe', 502)
  }

  track({ agencyId, userId: user.id, event: 'whatsapp_webhook_subscribed', props: {} })

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
    console.error('[WhatsappConnect] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // The selected, server-side pending phone has now passed WABA subscription
  // and been persisted. This is the legacy flow's genuine signup completion;
  // an existing row is a retry/reconnect, not a new completion.
  if (!existing) {
    await trackOncePerAgency(agencyId, 'whatsapp_signup_completed', user.id, {})
  }

  cookieStore.delete('wa_phones')
  track({ agencyId, userId: user.id, event: 'whatsapp_connected_operational', props: {} })

  after(() =>
    emitLifecycleEvent({
      type: 'user.meta_connected',
      userId: user.id,
      agencyId,
      email: user.email,
      channel: 'whatsapp',
    }),
  )

  return NextResponse.json({ ok: true })
}
