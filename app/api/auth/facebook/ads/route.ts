import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { requireAgencyAdmin } from '@/lib/api/routeAuth'
import { isFacebookAdsReportingEnabledForAgency } from '@/lib/facebook/permissions'
import { ADS_OAUTH_STATE_PREFIX } from '@/lib/facebook/ads/handleAdsOAuthCallback'

/**
 * Start the ad-reporting authorization: `ads_read` ONLY.
 *
 * Its own consent, separate from the Page connection: ad accounts are not Page
 * assets, and a user who only wants ad performance should see exactly one
 * permission on Meta's screen. It reuses the registered redirect URI; the
 * callback dispatches on the `ads.` state prefix before touching the Page flow.
 * Never `ads_management` — reporting is read-only.
 */
export async function GET(_req: NextRequest) {
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/auth`)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/sum_sales/ads?ads_error=forbidden`)
  }
  if (!isFacebookAdsReportingEnabledForAgency(auth.user.agencyId)) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/sum_sales`)
  }

  const state = `${ADS_OAUTH_STATE_PREFIX}${crypto.randomUUID()}`
  const cookieStore = await cookies()
  cookieStore.set('fb_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: process.env.META_REDIRECT_URI!,
    scope: 'ads_read',
    state,
    response_type: 'code',
    auth_type: 'rerequest',
    display: 'popup',
  })
  return NextResponse.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`)
}
