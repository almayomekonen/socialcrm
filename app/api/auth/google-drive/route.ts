import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AuthError, requireAgencyUser, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { decryptSecret } from '@/lib/crypto/secrets'
import {
  deleteDriveConnectionByUserId,
  getDriveConnectionByUserId,
} from '@/db/googleDriveConnections'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

export async function GET(_req: NextRequest) {
  let user: AuthenticatedAgencyUser
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) {
      // no_agency fails before OAuth so the user never walks the consent screen
      // only to be rejected on return.
      if (err.reason === 'no_agency') {
        console.warn('[GoogleDriveOAuth] start blocked: no_agency')
        return NextResponse.json({ error: 'no_agency' }, { status: 500 })
      }
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/auth`)
    }
    throw err
  }

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI
  if (!clientId || !redirectUri) {
    console.error('[GoogleDriveOAuth] Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_REDIRECT_URI')
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 })
  }

  // Disconnect any existing connection first. A row from an earlier consent
  // round can carry stale (e.g. drive.readonly-less) scopes; clearing it
  // forces this flow to issue a brand-new token set with the scopes below.
  // Revoke at Google is best-effort — local row deletion is what matters.
  const existing = await getDriveConnectionByUserId(user.id)
  if (existing) {
    try {
      const refresh = decryptSecret(existing.refresh_token)
      const revokeRes = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
      if (!revokeRes.ok) {
        console.warn(`[GoogleDriveOAuth] pre-connect revoke failed [userId=${user.id}]:`, await revokeRes.text())
      }
    } catch (err) {
      console.warn(`[GoogleDriveOAuth] pre-connect revoke threw [userId=${user.id}]:`, err)
    }
    await deleteDriveConnectionByUserId(user.id)
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set('gdrive_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  // openid + email scopes let us call userinfo at the callback to display
  // which Google account is connected. They do not grant any Drive access
  // beyond drive.readonly.
  //
  // include_granted_scopes=false: do NOT carry forward previously consented
  // scopes. Forces a fresh consent set so a prior consent that lacked
  // drive.readonly cannot silently produce a token without it.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  })

  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`)
}
