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

  // Upsert by page_id — one page can only belong to one user at a time
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

  // Subscribe page to receive leadgen webhook events
  // This is required — without it Meta will never fire the webhook for this page
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      body: new URLSearchParams({
        access_token: pageAccessToken,
        subscribed_fields: 'leadgen',
      }),
    })
    if (!res.ok) {
      // Log but don't fail — connection is saved, user can retry or re-connect
      console.error(`[FacebookConnect] Page subscription failed [pageId=${pageId}]:`, await res.text())
    } else {
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
    }
  } catch (err) {
    console.error(`[FacebookConnect] Page subscription threw [pageId=${pageId}]:`, err)
  }

  // Clear the pending pages cookie
  const cookieStore = await cookies()
  cookieStore.delete('fb_pages')

  return NextResponse.json({ ok: true })
}
