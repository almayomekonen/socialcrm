import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyAdmin } from '@/lib/api/routeAuth'
import { cookies } from 'next/headers'
import { track } from '@/lib/analytics/track'

export async function GET(_req: NextRequest) {
  // Connecting a Page and re-running OAuth to change it both start here, so the
  // admin boundary belongs at this step rather than only at /connect — a user
  // who may not finish the flow should not be sent to Meta to begin it.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/auth`)
    }
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/settings/integrations?notice=forbidden`)
  }
  const user = auth.user

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
    // `pages_read_user_content` is APPROVED by Meta and is the only permission
    // that makes a Page comment's `message` appear on the `feed` webhook. It was
    // never requested, so `hasCommentTextCapability` — written to flip on its own
    // once granted — could never become true and the Comments Inbox showed rows
    // with no text. It is OPTIONAL to the flow: unlike `leads_retrieval` the
    // callback must never hard-fail without it (Lead Ads keep working), it only
    // records the grant so the UI can offer a reconnect.
    scope: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_metadata',
      'leads_retrieval',
      'pages_read_user_content',
    ].join(','),
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
