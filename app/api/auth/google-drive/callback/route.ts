import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthError, requireAgencyUser, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { encryptSecret } from '@/lib/crypto/secrets'
import { sanitizeReturnTo, DEFAULT_RETURN } from '@/lib/oauth/returnTo'
import { upsertDriveConnection } from '@/db/googleDriveConnections'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export async function GET(req: NextRequest) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) {
      // Pre-cookie failure: fall back to the default origin.
      if (err.reason === 'no_agency')
        return NextResponse.redirect(new URL(`${DEFAULT_RETURN}?gdrive_error=no_agency`, req.url))
      return NextResponse.redirect(new URL('/auth', req.url))
    }
    throw err
  }

  const cookieStore = await cookies()

  // Consume the origin the user started from (set in the start route). Delete it
  // so it can't leak into a later flow; fall back to /dashboard when absent.
  const returnTo = sanitizeReturnTo(cookieStore.get('gdrive_return_to')?.value) ?? DEFAULT_RETURN
  cookieStore.delete('gdrive_return_to')

  const redirectBack = (key: string, value: string) => {
    const url = new URL(returnTo, req.url)
    url.searchParams.set(key, value)
    return NextResponse.redirect(url)
  }
  const failed = (reason: string) => redirectBack('gdrive_error', reason)

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[GoogleDriveOAuth] User denied:', error)
    return failed('denied')
  }

  // CSRF state verification — mirrors the Facebook flow.
  const storedState = cookieStore.get('gdrive_oauth_state')?.value
  cookieStore.delete('gdrive_oauth_state')

  if (!state || state !== storedState) {
    console.error('[GoogleDriveOAuth] State mismatch — possible CSRF')
    return failed('state')
  }

  if (!code) return failed('no_code')

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    console.error('[GoogleDriveOAuth] Missing GOOGLE_DRIVE_* env vars')
    return failed('misconfigured')
  }

  let tokens: { access_token: string; refresh_token?: string; expires_in: number; scope: string }
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
    if (!res.ok) {
      console.error('[GoogleDriveOAuth] Token exchange failed:', await res.text())
      return failed('token')
    }
    tokens = await res.json()
  } catch (err) {
    console.error('[GoogleDriveOAuth] Token exchange threw:', err)
    return failed('token')
  }

  if (COPILOT_TRACE) {
    // TEMPORARY [drive.debug] — verify drive.file is present in the granted scope set.
    console.info('[copilot.trace] drive.oauth.scopes', { scopes: tokens.scope })
  }

  // Validate that drive.file was actually granted. Google can silently
  // drop scopes if the OAuth consent screen has not been configured to
  // request them, or if the user un-checks individual scopes mid-consent.
  // Persisting tokens without drive.file produces a "Connected" row
  // whose every Drive API call fails with 403 — confusing UX. Fail the
  // flow now and surface a clear error code instead.
  if (!tokens.scope || !tokens.scope.includes('https://www.googleapis.com/auth/drive.file')) {
    console.error('[GoogleDriveOAuth] Missing drive.file in granted scopes:', tokens.scope)
    return failed('missing_drive_scope')
  }

  // We always send prompt=consent on the start route, which forces Google to
  // re-issue a refresh_token. If it's missing, something upstream is wrong
  // (e.g. user revoked + reconnected without prompt=consent) and we'd end up
  // with a connection we can't refresh — fail the flow rather than persist a
  // broken row.
  if (!tokens.refresh_token) {
    console.error('[GoogleDriveOAuth] No refresh_token returned')
    return failed('no_refresh_token')
  }

  let profile: { sub: string; email: string }
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!res.ok) {
      console.error('[GoogleDriveOAuth] userinfo failed:', await res.text())
      return failed('userinfo')
    }
    profile = await res.json()
  } catch (err) {
    console.error('[GoogleDriveOAuth] userinfo threw:', err)
    return failed('userinfo')
  }

  try {
    await upsertDriveConnection({
      userId: user.id,
      agencyId: user.agencyId,
      googleSub: profile.sub,
      googleEmail: profile.email,
      encryptedAccessToken: encryptSecret(tokens.access_token),
      encryptedRefreshToken: encryptSecret(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
    })
  } catch (err) {
    console.error('[GoogleDriveOAuth] DB upsert failed:', err)
    return failed('db')
  }

  return redirectBack('gdrive', 'connected')
}
