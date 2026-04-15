import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    return NextResponse.json({ error: 'subscription_failed' }, { status: 502 })
  }

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

  return NextResponse.json({ ok: true })
}
