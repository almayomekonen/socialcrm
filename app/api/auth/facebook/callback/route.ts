import { NextRequest, NextResponse } from 'next/server'
import { getUser, encrypt } from '@/db/auth'
import { cookies } from 'next/headers'

const failed = (req: NextRequest, reason: string) => NextResponse.redirect(new URL(`/settings/facebook?error=${reason}`, req.url))

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/auth', req.url))

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[FacebookOAuth] User denied permission:', error)
    return failed(req, 'denied')
  }

  // Validate CSRF state
  const cookieStore = await cookies()
  const storedState = cookieStore.get('fb_oauth_state')?.value
  cookieStore.delete('fb_oauth_state')

  if (!state || state !== storedState) {
    console.error('[FacebookOAuth] State mismatch — possible CSRF attack')
    return failed(req, 'state')
  }

  if (!code) return failed(req, 'no_code')

  const appId = process.env.FACEBOOK_APP_ID!
  const appSecret = process.env.FACEBOOK_APP_SECRET!
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback`

  // Step 1: Exchange code for short-lived user token
  let shortToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`,
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

  // Step 2: Exchange short-lived token for long-lived token (~60 days)
  let longToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
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

  // Step 3: Fetch user's pages (page tokens derived from long-lived token don't expire)
  let pages: { id: string; name: string; access_token: string }[]
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longToken}&fields=id,name,access_token`)
    if (!res.ok) {
      console.error('[FacebookOAuth] Fetch pages failed:', await res.text())
      return failed(req, 'pages')
    }
    const data = await res.json()
    pages = data.data ?? []
  } catch (err) {
    console.error('[FacebookOAuth] Fetch pages threw:', err)
    return failed(req, 'pages')
  }

  if (pages.length === 0) {
    console.warn('[FacebookOAuth] No pages found for user:', user.id)
    return failed(req, 'no_pages')
  }

  // Store pages in encrypted short-lived cookie — userId bound to prevent session swap attacks
  const encrypted = await encrypt({ pages, userId: user.id })
  cookieStore.set('fb_pages', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  return NextResponse.redirect(new URL('/settings/facebook?select=1', req.url))
}
