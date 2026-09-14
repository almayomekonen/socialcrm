import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyAdmin } from '@/lib/api/routeAuth'
import { cookies } from 'next/headers'
import { track } from '@/lib/analytics/track'
import {
  isFacebookCommentRepliesEnabledForAgency,
  isFacebookMessengerEnabledForAgency,
  pageOAuthScopes,
  parsePageFeature,
} from '@/lib/facebook/permissions'
import { inAppBrowserFromHeaders } from '@/lib/device'

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
  const search = new URL(_req.url).searchParams
  const origin = search.get('origin') === 'activation' ? 'activation' : 'settings'
  // Per-feature permissions (lib/facebook/permissions.ts): `?feature=messenger`
  // or `?feature=comment_replies` adds ONLY that feature's permissions to the
  // unchanged base set. The feature rides the state so the callback can return
  // the user to the surface that asked. Routing only — CSRF stays exact-match.
  // A feature outside this agency's rollout is ignored: nobody is asked for a
  // permission the product will not use for them.
  const requested = parsePageFeature(search.get('feature'))
  const rolledOut =
    requested === 'messenger'
      ? isFacebookMessengerEnabledForAgency(user.agencyId)
      : requested === 'comment_replies'
        ? isFacebookCommentRepliesEnabledForAgency(user.agencyId)
        : false
  const feature = rolledOut ? requested : null
  const state = feature ? `${origin}.${feature}.${crypto.randomUUID()}` : `${origin}.${crypto.randomUUID()}`

  // The DENOMINATOR of the Facebook connect funnel. `facebook_connect_started`
  // was declared in the event union but emitted nowhere, so OAuth-dialog
  // abandonment — a user who taps "connect" and never returns — was invisible:
  // the funnel could only ever start at `facebook_oauth_completed`, i.e. at the
  // users who already succeeded. Not awaited; track() never throws and an
  // analytics write must not delay the redirect to Meta.
  // `inApp`: inside Instagram's/Facebook's in-app browser this redirect often
  // never returns from Meta, so the start is the only place that fact is known.
  // `feature`: a per-feature permission request (null for a plain connection), so
  // the connect funnel can separate onboarding from permission upgrades.
  const inApp = inAppBrowserFromHeaders(_req.headers)
  void track({
    agencyId: user.agencyId!,
    userId: user.id,
    event: 'facebook_connect_started',
    props: { origin, feature, inApp },
  })
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
    // Base set unchanged: Lead Ads (`leads_retrieval`) plus comment text
    // (`pages_read_user_content`, OPTIONAL — the callback never hard-fails
    // without it). A feature adds only its own permissions; see permissions.ts.
    scope: pageOAuthScopes(feature).join(','),
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
