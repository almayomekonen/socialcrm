import { NextRequest, NextResponse } from 'next/server'
import { getUser, encrypt } from '@/db/auth'
import { cookies } from 'next/headers'

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/facebook/callback`

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!

const failed = (_req: NextRequest, reason: string) => NextResponse.redirect(`${BASE_URL}/settings/facebook?error=${reason}`)

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(`${BASE_URL}/auth`)

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[FacebookOAuth] User denied permission:', error)
    return failed(req, 'denied')
  }

  const cookieStore = await cookies()
  const storedState = cookieStore.get('fb_oauth_state')?.value
  cookieStore.delete('fb_oauth_state')

  if (!state || state !== storedState) {
    console.error('[FacebookOAuth] State mismatch — possible CSRF attack')
    return failed(req, 'state')
  }

  if (!code) return failed(req, 'no_code')

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  console.log('[FacebookOAuth] Callback received — code present:', !!code, 'appId:', appId, 'redirectUri:', REDIRECT_URI)

  let shortToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${code}`,
    )
    if (!res.ok) {
      console.error('[FacebookOAuth] Short token exchange failed:', await res.text())
      return failed(req, 'token')
    }
    const data = await res.json()
    shortToken = data.access_token
  } catch (err) {
    console.error('[FacebookOAuth] Short token exchange threw:', err)
    return failed(req, 'token')
  }

  let longToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    )
    if (!res.ok) {
      console.error('[FacebookOAuth] Long token exchange failed:', await res.text())
      return failed(req, 'token')
    }
    const data = await res.json()
    longToken = data.access_token
  } catch (err) {
    console.error('[FacebookOAuth] Long token exchange threw:', err)
    return failed(req, 'token')
  }

  const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`)
  if (!pagesRes.ok) {
    console.error('[FacebookOAuth] Failed to fetch pages:', await pagesRes.text())
    return failed(req, 'no_pages')
  }

  const pagesData = await pagesRes.json()
  const pages: { id: string; name: string; access_token: string }[] = (pagesData.data || []).map(
    (p: { id: string; name: string; access_token: string }) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
    }),
  )

  if (pages.length === 0) {
    console.warn('[FacebookOAuth] No pages found for userId:', user.id)
    return failed(req, 'no_pages')
  }

  const encrypted = await encrypt({ pages, userId: user.id })
  cookieStore.set('fb_pages', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  return NextResponse.redirect(`${BASE_URL}/settings/facebook`)
}
