import { NextRequest, NextResponse, after } from 'next/server'
import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import { emitLifecycleEvent } from '@/lib/events/emit'
import { GRAPH_BASE as GRAPH } from '@/lib/facebook/graph'
import { track } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'

function fail(agencyId: number, userId: number, reason: WaReason, stage: string, status = 400) {
  track({ agencyId, userId, event: 'whatsapp_connect_failed', props: { reason, stage } })
  return NextResponse.json({ ok: false, error: WA_REASON_NOTICE_CODE[reason], reason }, { status })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agencyId = user.agencyId!

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
