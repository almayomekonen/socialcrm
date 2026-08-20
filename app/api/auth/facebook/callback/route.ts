import { NextRequest, NextResponse } from 'next/server'
import { getUser, encrypt } from '@/db/auth'
import { cookies } from 'next/headers'
import { track } from '@/lib/analytics/track'
import { FB_REASON, FB_REASON_NOTICE_CODE, type FbReason } from '@/lib/connections/reasons'
import { inspectFacebookToken } from '@/lib/facebook/pageDiscoveryDiagnostics'
import { discoverFacebookPages } from '@/lib/facebook/discoverPages'

// Option A: the flow origin is the prefix of the `state` param. Reading it for
// routing is not security-sensitive (the CSRF check below remains exact-match).
function originOf(req: NextRequest): 'settings' | 'activation' {
  const state = new URL(req.url).searchParams.get('state') ?? ''
  return state.startsWith('activation.') ? 'activation' : 'settings'
}

const failed = (req: NextRequest, reason: string) => {
  const url =
    originOf(req) === 'activation'
      ? `/activate?activation=error&reason=${reason}`
      : `/settings/facebook?error=${reason}`
  return NextResponse.redirect(new URL(url, req.url))
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/auth', req.url))

  // Precise, non-PII failure reason → analytics. Notice code (redirect) is
  // unchanged; only the observability reason is added. `diagnostics` carries
  // the safe, derived Page-discovery evidence (see pageDiscoveryDiagnostics.ts);
  // it is never allowed to contain a token, secret, or raw asset id.
  const trackFbFail = (reason: FbReason, stage: string, diagnostics?: Record<string, unknown>) =>
    track({
      agencyId: user.agencyId!,
      userId: user.id,
      event: 'facebook_connect_failed',
      props: { reason, stage, ...diagnostics },
    })
  let pagesShowListGranted = false

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[FacebookOAuth] User denied permission:', error)
    trackFbFail(FB_REASON.ACCESS_DENIED, 'oauth')
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

  // FIX 3: Verify that leads_retrieval was actually granted before proceeding.
  // Facebook allows users to uncheck individual scopes during OAuth — the token exchange
  // still succeeds, but without leads_retrieval the integration is silently broken.
  try {
    const permRes = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${longToken}`)
    if (!permRes.ok) {
      console.error('[FacebookOAuth] Permission check failed:', await permRes.text())
      return failed(req, 'token')
    }
    const permData = await permRes.json()
    const granted = (perm: string) =>
      (permData.data ?? []).some(
        (p: { permission: string; status: string }) => p.permission === perm && p.status === 'granted',
      )
    if (!granted('leads_retrieval')) {
      console.warn('[FacebookOAuth] leads_retrieval not granted — userId:', user.id)
      trackFbFail(FB_REASON.LEADS_PERMISSION_MISSING, 'permissions')
      return failed(req, 'missing_permission')
    }
    // Capture whether pages_show_list was granted so a later empty /me/accounts
    // can be classified as "permission missing" vs "account genuinely has no
    // Page". Both currently share the approved 'no_pages' notice; the precise
    // reason is recorded in analytics for the recovery-UX slice.
    pagesShowListGranted = granted('pages_show_list')
    console.log('[FacebookOAuth] leads_retrieval confirmed granted — userId:', user.id)
  } catch (err) {
    console.error('[FacebookOAuth] Permission check threw:', err)
    return failed(req, 'token')
  }

  track({ agencyId: user.agencyId!, userId: user.id, event: 'facebook_oauth_completed', props: {} })

  // Reads the freshly-exchanged token's granular scopes. This is BOTH the
  // diagnostic that explained the production failure AND — now that it has —
  // the source of the Page ids discovery resolves. It never gates the flow and
  // never throws; when it is unavailable, discovery falls back to /me/accounts.
  const tokenDiag = await inspectFacebookToken(longToken, appId, appSecret)

  // Step 3: Discover the authorised Pages. Granular `target_ids` first (the
  // exact Pages the user approved — the only source that sees Pages in the New
  // Pages Experience / owned by a Business Portfolio), /me/accounts as fallback.
  // See discoverPages.ts for why: `/me/accounts` answers 200 {"data":[]} for
  // those Pages even though consent was recorded.
  const discovery = await discoverFacebookPages(longToken, tokenDiag.grantedPageIds)
  const pages = discovery.pages

  // Recorded on EVERY discovery attempt — success and failure alike — so a
  // failing customer can be compared against a working one. Safe by
  // construction: derived counts, permission names, and a truncated user hash.
  // `tokenDiag.grantedPageIds` is deliberately NOT spread in — raw Page ids
  // never reach a log line or the analytics table.
  // agencyId/userId are omitted here because `track()` already writes them as
  // first-class indexed columns on analytics_events.
  const discoveryDiag: Record<string, unknown> = {
    httpStatus: discovery.diagnostics.httpStatus,
    pagesShowListGranted,
    grantedPageIdCount: tokenDiag.grantedPageIdCount,
    granularPagesEntryPresent: tokenDiag.granularPagesEntryPresent,
    fbUserIdHash: tokenDiag.fbUserIdHash,
    tokenScopes: tokenDiag.scopes,
    tokenIsValid: tokenDiag.tokenIsValid,
    debugTokenOk: tokenDiag.debugTokenOk,
    // Which source produced the Pages, and how the granular attempt fared.
    discoverySource: discovery.diagnostics.discoverySource,
    granularAttemptedCount: discovery.diagnostics.granularAttemptedCount,
    granularResolvedCount: discovery.diagnostics.granularResolvedCount,
  }

  if (discovery.providerError) {
    // A non-2xx from Meta is a PROVIDER error, never "this account has no Page".
    // Conflating the two is what made 33 production failures unreadable.
    const diagnostics = { ...discoveryDiag, ...discovery.providerError, returnedPageCount: 0 }
    console.error('[FacebookOAuth] /me/accounts provider error', diagnostics)
    trackFbFail(FB_REASON.PROVIDER_ERROR, 'discover', diagnostics)
    // User-facing notice stays generic and approved; Meta internals never reach
    // the browser — only the analytics row and the server log carry them.
    return failed(req, FB_REASON_NOTICE_CODE[FB_REASON.PROVIDER_ERROR])
  }

  const discoveryResult = {
    ...discoveryDiag,
    dataKeyPresent: discovery.diagnostics.dataKeyPresent,
    returnedPageCount: pages.length,
  }
  console.log('[FacebookOAuth] page discovery result', discoveryResult)

  if (pages.length === 0) {
    // Reached ONLY after BOTH sources came back clean-but-empty: no granular
    // Page resolved, and /me/accounts answered 2xx with zero Pages. So
    // `NO_PAGES` means what it says. When the Page permission was not granted
    // at all we still report the honest pages_permission state instead.
    // `grantedPageIdCount` / `granularResolvedCount` in the analytics row are
    // what separate "granted, scoped to zero Pages" from "granted Pages, yet
    // neither source could resolve them" — they do NOT drive this
    // classification.
    const reason = pagesShowListGranted ? FB_REASON.NO_PAGES : FB_REASON.PAGES_PERMISSION_MISSING
    trackFbFail(reason, 'discover', discoveryResult)
    return failed(req, FB_REASON_NOTICE_CODE[reason])
  }

  track({
    agencyId: user.agencyId!,
    userId: user.id,
    event: 'facebook_page_discovered',
    props: { count: pages.length, ...discoveryResult },
  })

  const encrypted = await encrypt({ pages, userId: user.id })
  cookieStore.set('fb_pages', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  const successUrl =
    originOf(req) === 'activation' ? '/activate?activation=select' : '/settings/facebook?select=1'
  return NextResponse.redirect(new URL(successUrl, req.url))
}
