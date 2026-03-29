import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { phoneNumberId: string; accessToken: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { phoneNumberId, accessToken } = body
  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
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
    console.error('[WhatsappConnect] DB upsert failed:', err)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const cookieStore = await cookies()
  cookieStore.delete('wa_phones')

  return NextResponse.json({ ok: true })
}
