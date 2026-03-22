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

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const redirectUri = process.env.META_REDIRECT_URI!

  console.log('[FacebookOAuth] Callback received — code present:', !!code, 'appId:', appId, 'redirectUri:', redirectUri)

  let shortToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`,
    )
    if (!res.ok) {
      console.error('[FacebookOAuth] Short token exchange failed:', await res.text())
      return failed(req, 'token')
    }
    const data = await res.json()
    shortToken = data.access_token
    console.log('FB ACCESS TOKEN:', data.access_token)
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

  // Step 3: Discover which page IDs the token has access to via debug_token granular_scopes.
  // This is the reliable modern approach — granular_scopes.target_ids contains the exact
  // page IDs the user approved, regardless of NPE or Business Manager setup.
  let pageIds: string[] = []
  try {
    const debugRes = await fetch(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${longToken}&access_token=${appId}|${appSecret}`,
    )
    const debugData = await debugRes.json()
    console.log('[FacebookOAuth] Token debug:', JSON.stringify(debugData?.data ?? debugData))

    const granularScopes: { scope: string; target_ids?: string[] }[] = debugData?.data?.granular_scopes ?? []
    const pagesEntry = granularScopes.find((s) => s.scope === 'pages_show_list' || s.scope === 'pages_read_engagement')
    pageIds = pagesEntry?.target_ids ?? []
    console.log('[FacebookOAuth] Page IDs from granular_scopes:', pageIds)
  } catch (err) {
    console.error('[FacebookOAuth] debug_token threw:', err)
  }

  // Fallback: use META_PAGE_ID env var if granular_scopes returned nothing
  if (pageIds.length === 0 && process.env.META_PAGE_ID) {
    console.warn('[FacebookOAuth] granular_scopes empty — falling back to META_PAGE_ID env var')
    pageIds = [process.env.META_PAGE_ID]
  }

  // Step 4: Fetch page access token for each discovered page ID
  let pages: { id: string; name: string; access_token: string }[] = []
  for (const pageId of pageIds) {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name,access_token&access_token=${longToken}`)
      const page = await res.json()
      console.log(`[FacebookOAuth] PAGE DATA [${pageId}]:`, JSON.stringify(page))
      if (res.ok && page.access_token) {
        pages.push({ id: page.id, name: page.name, access_token: page.access_token })
      } else {
        console.error(`[FacebookOAuth] No access_token for page ${pageId}:`, JSON.stringify(page))
      }
    } catch (err) {
      console.error(`[FacebookOAuth] Page fetch threw for ${pageId}:`, err)
    }
  }

  if (pages.length === 0) {
    console.warn('[FacebookOAuth] No page access token found for userId:', user.id)
    return failed(req, 'no_pages')
  }

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
