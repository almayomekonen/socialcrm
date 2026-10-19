import { db } from '@/config/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { getCalendarConnectionByUserId, updateCalendarConnectionStatus } from '@/db/googleCalendarConnections'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

const REFRESH_BUFFER_MS = 60_000

export class CalendarAuthError extends Error {
  constructor(public reason: 'not_connected' | 'refresh_failed' | 'reauth_required' | 'missing_scope') {
    super(reason)
    this.name = 'CalendarAuthError'
  }
}

export async function getValidCalendarAccessToken(userId: number): Promise<string> {
  const conn = await getCalendarConnectionByUserId(userId)
  if (!conn) throw new CalendarAuthError('not_connected')
  if (conn.sync_status !== 'active') throw new CalendarAuthError('reauth_required')

  if (!conn.scope || !conn.scope.includes(CALENDAR_EVENTS_SCOPE)) {
    throw new CalendarAuthError('missing_scope')
  }

  const expiresAtMs = conn.expires_at instanceof Date ? conn.expires_at.getTime() : new Date(conn.expires_at).getTime()

  if (expiresAtMs - Date.now() > REFRESH_BUFFER_MS) {
    return decryptSecret(conn.access_token)
  }

  return refreshAndPersist({ userId, encryptedRefreshToken: conn.refresh_token })
}

async function refreshAndPersist({
  userId,
  encryptedRefreshToken,
}: {
  userId: number
  encryptedRefreshToken: string
}): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('[calendar] GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET not set')
  }

  const refresh = decryptSecret(encryptedRefreshToken)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')

    if (res.status === 400 && body.includes('invalid_grant')) {
      await updateCalendarConnectionStatus(userId, 'reauth_required', 'refresh_token_revoked').catch(() => {})
      throw new CalendarAuthError('reauth_required')
    }
    console.warn(`[calendar] token refresh failed [userId=${userId}]: ${res.status} ${body.slice(0, 200)}`)
    throw new CalendarAuthError('refresh_failed')
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  const updates: { access_token: string; expires_at: Date; refresh_token?: string } = {
    access_token: encryptSecret(data.access_token),
    expires_at: new Date(Date.now() + data.expires_in * 1000),
  }
  if (data.refresh_token) {
    updates.refresh_token = encryptSecret(data.refresh_token)
  }

  await db('google_calendar_connections').where({ user_id: userId }).update(updates)

  return data.access_token
}
