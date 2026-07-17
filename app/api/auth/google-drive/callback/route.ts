import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthError, requireAgencyUser, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { encryptSecret } from '@/lib/crypto/secrets'
import { upsertDriveConnection } from '@/db/googleDriveConnections'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

const failed = (req: NextRequest, reason: string) =>
  NextResponse.redirect(new URL(`/dashboard?gdrive_error=${reason}`, req.url))

export async function GET(req: NextRequest) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.reason === 'no_agency') return failed(req, 'no_agency')
      return NextResponse.redirect(new URL('/auth', req.url))
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[GoogleDriveOAuth] User denied:', error)
    return failed(req, 'denied')
  }

  // CSRF state verification — mirrors the Facebook flow.
  const cookieStore = await cookies()
  const storedState = cookieStore.get('gdrive_oauth_state')?.value
  cookieStore.delete('gdrive_oauth_state')

  if (!state || state !== storedState) {
    console.error('[GoogleDriveOAuth] State mismatch — possible CSRF')
    return failed(req, 'state')
  }

  if (!code) return failed(req, 'no_code')

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    console.error('[GoogleDriveOAuth] Missing GOOGLE_DRIVE_* env vars')
    return failed(req, 'misconfigured')
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
      return failed(req, 'token')
    }
    tokens = await res.json()
  } catch (err) {
    console.error('[GoogleDriveOAuth] Token exchange threw:', err)
    return failed(req, 'token')
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
    return failed(req, 'missing_drive_scope')
  }

  // We always send prompt=consent on the start route, which forces Google to
  // re-issue a refresh_token. If it's missing, something upstream is wrong
  // (e.g. user revoked + reconnected without prompt=consent) and we'd end up
  // with a connection we can't refresh — fail the flow rather than persist a
  // broken row.
  if (!tokens.refresh_token) {
    console.error('[GoogleDriveOAuth] No refresh_token returned')
    return failed(req, 'no_refresh_token')
  }

  let profile: { sub: string; email: string }
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!res.ok) {
      console.error('[GoogleDriveOAuth] userinfo failed:', await res.text())
      return failed(req, 'userinfo')
    }
    profile = await res.json()
  } catch (err) {
    console.error('[GoogleDriveOAuth] userinfo threw:', err)
    return failed(req, 'userinfo')
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
    return failed(req, 'db')
  }

  return NextResponse.redirect(new URL('/dashboard?gdrive=connected', req.url))
}
