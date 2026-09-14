import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { saveAdConnection } from '@/db/facebookAds'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'

/**
 * OAuth return for ad reporting (`ads_read`). Dispatched from the shared
 * Facebook callback when the state carries the `ads.` prefix, BEFORE any of the
 * Page-connection logic runs — so the Lead Ads flow is untouched.
 *
 * Same guarantees as the Page flow: exact-match CSRF state, admin-only (checked
 * by the caller), code exchanged server-side, long-lived token stored sealed,
 * and the grant read from Meta (`/me/permissions`) rather than assumed. A user
 * who unticks `ads_read` gets an honest "declined" state and nothing is stored.
 */

export const ADS_OAUTH_STATE_PREFIX = 'ads.'

const RETURN = '/sum_sales/ads'
const back = (req: NextRequest, query: string) => NextResponse.redirect(new URL(`${RETURN}?${query}`, req.url))

type Exchange = { access_token?: string; expires_in?: number }

async function exchange(url: string): Promise<Exchange | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Exchange
  } catch {
    return null
  }
}

export async function handleAdsOAuthCallback(req: NextRequest, user: { id: number; agencyId: number }) {
  const params = new URL(req.url).searchParams
  const state = params.get('state')
  const cookieStore = await cookies()
  const stored = cookieStore.get('fb_oauth_state')?.value
  cookieStore.delete('fb_oauth_state')

  if (!state || state !== stored) return back(req, 'ads_error=state')
  if (!isFacebookAdsReportingEnabledForAgency(user.agencyId)) return NextResponse.redirect(new URL('/sum_sales', req.url))
  if (params.get('error')) return back(req, 'ads_error=denied')
  const code = params.get('code')
  if (!code) return back(req, 'ads_error=denied')

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const redirectUri = process.env.META_REDIRECT_URI!

  // Same exchange the Page connection performs (server-to-server; never logged).
  const short = await exchange(
    `https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    })}`,
  )
  if (!short?.access_token) return back(req, 'ads_error=token')
  const long = await exchange(
    `https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    })}`,
  )
  const token = long?.access_token ?? short.access_token

  let granted: string[] = []
  try {
    const res = await fetch('https://graph.facebook.com/v19.0/me/permissions', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    // A failed read says nothing about what was granted: a token problem, not a decline.
    if (!res.ok) return back(req, 'ads_error=token')
    const body = (await res.json()) as { data?: { permission?: unknown; status?: unknown }[] }
    granted = (body.data ?? [])
      .filter((p) => p?.status === 'granted' && typeof p.permission === 'string')
      .map((p) => p.permission as string)
  } catch {
    return back(req, 'ads_error=token')
  }
  if (!granted.includes('ads_read')) return back(req, 'ads_error=declined')

  try {
    await saveAdConnection({
      agencyId: user.agencyId,
      userId: user.id,
      accessToken: token,
      grantedScopes: granted,
      expiresInSeconds: typeof long?.expires_in === 'number' ? long.expires_in : null,
    })
  } catch (err) {
    console.error('[AdsOAuth] could not save the ad connection:', err instanceof Error ? err.message : 'unknown')
    return back(req, 'ads_error=save')
  }
  return back(req, 'connected=1')
}
