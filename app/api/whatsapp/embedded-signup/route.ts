import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { GRAPH_BASE as GRAPH } from '@/lib/facebook/graph'
import { ensureMessagingReady } from '@/lib/whatsapp/registration'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  let accessToken: string
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`)
    if (!res.ok) {
      console.error('[WA EmbeddedSignup] token exchange failed:', res.status, await res.text())
      return NextResponse.json({ error: 'token' }, { status: 400 })
    }
    const data = await res.json()
    accessToken = data.access_token
    if (!accessToken) return NextResponse.json({ error: 'token' }, { status: 400 })
  } catch (e) {
    console.error('[WA EmbeddedSignup] token exchange threw:', e)
    return NextResponse.json({ error: 'token' }, { status: 400 })
  }

  if (wabaId) {
    try {
      const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) console.error('[WA EmbeddedSignup] subscribed_apps failed:', res.status, await res.text())
    } catch (e) {
      console.error('[WA EmbeddedSignup] subscribed_apps threw:', e)
    }
  }

  try {
    await db('whatsapp_connections')
      .insert({
        user_id: user.id,
        agency_id: user.agencyId,
        phone_number_id: phoneNumberId,
        access_token: accessToken,
      })
      .onConflict('phone_number_id')
      .merge({
        user_id: user.id,
        agency_id: user.agencyId,
        access_token: accessToken,
      })
  } catch (err) {
    console.error('[WA EmbeddedSignup] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const readiness = await ensureMessagingReady(phoneNumberId, accessToken)

  return NextResponse.json({ ok: true, messagingReady: readiness.ready, reason: readiness.reason })
}
