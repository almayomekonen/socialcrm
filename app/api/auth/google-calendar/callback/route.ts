import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthError, requireAgencyUser, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { encryptSecret } from '@/lib/crypto/secrets'
import { sanitizeReturnTo, DEFAULT_RETURN } from '@/lib/oauth/returnTo'
import { upsertCalendarConnection } from '@/db/googleCalendarConnections'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export async function GET(req: NextRequest) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) {
      // Pre-cookie failure: fall back to the default origin.
      if (err.reason === 'no_agency')
        return NextResponse.redirect(new URL(`${DEFAULT_RETURN}?gcal_error=no_agency`, req.url))
      return NextResponse.redirect(new URL('/auth', req.url))
    }
    throw err
  }

  const cookieStore = await cookies()

  // Consume the origin the user started from (set in the start route). Delete it
  // so it can't leak into a later flow; fall back to /dashboard when absent.
  const returnTo = sanitizeReturnTo(cookieStore.get('gcal_return_to')?.value) ?? DEFAULT_RETURN
  cookieStore.delete('gcal_return_to')

  const redirectBack = (key: string, value: string) => {
    const url = new URL(returnTo, req.url)
    url.searchParams.set(key, value)
    return NextResponse.redirect(url)
  }
  const failed = (reason: string) => redirectBack('gcal_error', reason)

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    console.warn('[GoogleCalendarOAuth] User denied:', error)
    return failed('denied')
  }

  // CSRF state verification — mirrors the Drive / Facebook flows.
  const storedState = cookieStore.get('gcal_oauth_state')?.value
  cookieStore.delete('gcal_oauth_state')

  if (!state || state !== storedState) {
    console.error('[GoogleCalendarOAuth] State mismatch — possible CSRF')
    return failed('state')
  }

  if (!code) return failed('no_code')

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    console.error('[GoogleCalendarOAuth] Missing GOOGLE_CALENDAR_* env vars')
    return failed('misconfigured')
  }

  let tokens: {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }
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
      console.error('[GoogleCalendarOAuth] Token exchange failed:', await res.text())
      return failed('token')
    }
    tokens = await res.json()
  } catch (err) {
    console.error('[GoogleCalendarOAuth] Token exchange threw:', err)
    return failed('token')
  }

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] calendar.oauth.scopes', { scopes: tokens.scope })
  }

  // Validate that calendar.events was actually granted. Google can silently
  // drop scopes if the consent screen has not been configured to request
  // them, or if the user un-checks scopes mid-consent. Persisting tokens
  // without calendar.events produces a "Connected" row whose every Calendar
  // API call fails with 403. Fail the flow now with a clear error code.
  if (!tokens.scope || !tokens.scope.includes(CALENDAR_EVENTS_SCOPE)) {
    console.error('[GoogleCalendarOAuth] Missing calendar.events in granted scopes:', tokens.scope)
    return failed('missing_calendar_scope')
  }

  // prompt=consent on the start route forces Google to re-issue a refresh
  // token. If it's missing we'd persist a row we can't refresh — fail rather
  // than store a broken connection.
  if (!tokens.refresh_token) {
    console.error('[GoogleCalendarOAuth] No refresh_token returned')
    return failed('no_refresh_token')
  }

  let profile: { sub: string; email: string }
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!res.ok) {
      console.error('[GoogleCalendarOAuth] userinfo failed:', await res.text())
      return failed('userinfo')
    }
    profile = await res.json()
  } catch (err) {
    console.error('[GoogleCalendarOAuth] userinfo threw:', err)
    return failed('userinfo')
  }

  try {
    await upsertCalendarConnection({
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
    console.error('[GoogleCalendarOAuth] DB upsert failed:', err)
    return failed('db')
  }

  return redirectBack('gcal', 'connected')
}
