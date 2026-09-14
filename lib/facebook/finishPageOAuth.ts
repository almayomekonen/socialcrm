import { NextRequest, NextResponse } from 'next/server'
import { missingFeatureScopes, parsePageFeature, type MetaPageFeature } from '@/lib/facebook/permissions'
import { PENDING_PAGES_COOKIE, PENDING_PAGES_MAX_AGE_S, sealPendingPagesCookie } from '@/lib/facebook/pendingPages'
import { refreshConnectedPages } from '@/lib/facebook/refreshConnectedPages'

/**
 * The last step of the Page OAuth callback, after Pages were discovered:
 * reconnect already-connected Pages, or hand the picker its Page list.
 *
 * Extracted from app/api/auth/facebook/callback/route.ts (architecture-rules §1)
 * so the route keeps its discovery and diagnostics logic, and this file owns
 * "where does the user go next".
 */

type CookieStore = { set: (name: string, value: string, options: Record<string, unknown>) => void }

/** Where a per-feature permission request returns: the surface that asked for it. */
const FEATURE_RETURN: Record<MetaPageFeature, string> = {
  comment_replies: '/inbox/comments',
  messenger: '/inbox/messenger',
}

/** `settings.messenger.<uuid>` → 'messenger'. Routing only; the CSRF check stays exact-match in the route. */
export function featureFromState(state: string | null): MetaPageFeature | null {
  const parts = (state ?? '').split('.')
  return parts.length === 3 ? parsePageFeature(parts[1]) : null
}

export async function finishPageOAuth(input: {
  req: NextRequest
  cookieStore: CookieStore
  user: { id: number; agencyId: number }
  origin: 'settings' | 'activation'
  pages: { id: string; name: string; access_token: string }[]
  grantedScopes: string[]
  failed: (reason: string) => NextResponse
}): Promise<NextResponse> {
  const { req, user, pages, grantedScopes } = input
  const feature = featureFromState(new URL(req.url).searchParams.get('state'))
  const featureMissing = feature ? missingFeatureScopes(grantedScopes, feature) : []
  if (feature) {
    // Permission names only. Not an analytics event: facebook_oauth_completed
    // already fired in the route and must count each round trip once.
    console.log('[FacebookOAuth] feature permission result', { feature, missing: featureMissing })
  }

  /**
   * RECONNECT. Pages THIS admin already connected are refreshed here — new
   * token (sealed), new grant, re-subscribed with the fields that grant allows.
   * Before this, a reconnect landed on a screen that never showed the picker for
   * an already-connected account, so the fresh token was discarded. Activation
   * is a first-connection flow and keeps its own picker path.
   */
  let refreshed = 0
  if (input.origin !== 'activation') {
    try {
      const result = await refreshConnectedPages({ agencyId: user.agencyId, userId: user.id, pages, grantedScopes })
      refreshed = result.refreshed
      if (result.subscribeFailed > 0) {
        console.warn('[FacebookOAuth] reconnect: re-subscribe refused for', result.subscribeFailed, 'page(s)')
      }
    } catch (err) {
      console.error('[FacebookOAuth] reconnect refresh failed:', err instanceof Error ? err.message : 'unknown')
      return input.failed('save_failed')
    }
  }

  if (refreshed > 0) {
    const target = feature
      ? `${FEATURE_RETURN[feature]}?permission=${featureMissing.length === 0 ? 'granted' : 'missing'}`
      : '/settings/facebook?reconnected=1'
    return NextResponse.redirect(new URL(target, req.url))
  }

  // First connection: the picker needs the Page list. The cookie is one encrypted
  // envelope; the browser only ever receives `{ id, name }`, and /connect resolves
  // the token server-side (pendingPages.ts). `grantedScopes` rides along so
  // /connect persists it without a second Graph call.
  let sealed: string
  try {
    sealed = sealPendingPagesCookie({ pages, userId: user.id, grantedScopes })
  } catch {
    console.error('[FacebookOAuth] pending Pages could not be sealed — SECRETS_ENC_KEY unavailable')
    return input.failed('save_failed')
  }
  input.cookieStore.set(PENDING_PAGES_COOKIE, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: PENDING_PAGES_MAX_AGE_S,
    path: '/',
  })

  const successUrl = input.origin === 'activation' ? '/activate?activation=select' : '/settings/facebook?select=1'
  return NextResponse.redirect(new URL(successUrl, req.url))
}
