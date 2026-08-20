import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { cookies } from 'next/headers'
import { track } from '@/lib/analytics/track'

export async function GET(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/auth`)

  // Generate CSRF state token and store in short-lived cookie.
  // Option A: the origin of the flow is carried in the state prefix so the
  // callback can return to the right surface. Default 'settings' preserves the
  // existing desktop behavior; 'activation' is the mobile activation flow.
  const origin = new URL(_req.url).searchParams.get('origin') === 'activation' ? 'activation' : 'settings'
  const state = `${origin}.${crypto.randomUUID()}`

  // The DENOMINATOR of the Facebook connect funnel. `facebook_connect_started`
  // was declared in the event union but emitted nowhere, so OAuth-dialog
  // abandonment — a user who taps "connect" and never returns — was invisible:
  // the funnel could only ever start at `facebook_oauth_completed`, i.e. at the
  // users who already succeeded. Not awaited; track() never throws and an
  // analytics write must not delay the redirect to Meta.
  void track({ agencyId: user.agencyId!, userId: user.id, event: 'facebook_connect_started', props: { origin } })
  const cookieStore = await cookies()
  cookieStore.set('fb_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: process.env.META_REDIRECT_URI!,
    scope: ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'].join(','),
    state,
    response_type: 'code',
    auth_type: 'rerequest',
    display: 'popup',
    auth_nonce: crypto.randomUUID(),
  })

  console.log(
    '[FacebookOAuth] Redirecting to OAuth dialog — appId:',
    process.env.META_APP_ID,
    'redirectUri:',
    process.env.META_REDIRECT_URI,
  )

  return NextResponse.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`)
}
