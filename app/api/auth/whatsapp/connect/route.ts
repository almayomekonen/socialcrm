import { NextRequest, NextResponse } from 'next/server'
import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  try {
    const payload = await decrypt(waPhonesCookie)
    if (payload?.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const phones = (payload.phones ?? []) as { id: string; accessToken: string }[]
    accessToken = phones.find((p) => p.id === phoneNumberId)?.accessToken
  } catch {
    return NextResponse.json({ error: 'Invalid pending connection' }, { status: 400 })
  }
  if (!accessToken) return NextResponse.json({ error: 'Phone not found in pending connection' }, { status: 400 })

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
    console.error('[WhatsappConnect] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  cookieStore.delete('wa_phones')

  return NextResponse.json({ ok: true })
}
