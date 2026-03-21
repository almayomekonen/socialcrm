import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'

export async function POST(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()
  if (!connection) return NextResponse.json({ ok: true })

  // Attempt to unsubscribe the page — best effort, don't block deletion on failure
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${connection.page_id}/subscribed_apps?access_token=${connection.page_access_token}`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      console.warn(`[FacebookDisconnect] Unsubscribe failed [pageId=${connection.page_id}]:`, await res.text())
    } else {
      console.log(`[FacebookDisconnect] Page unsubscribed [pageId=${connection.page_id}]`)
    }
  } catch (err) {
    console.warn(`[FacebookDisconnect] Unsubscribe threw [pageId=${connection.page_id}]:`, err)
  }

  await db('facebook_pages').where({ user_id: user.id }).delete()

  return NextResponse.json({ ok: true })
}
