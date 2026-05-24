import { db } from '@/config/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import {
  deleteDriveConnectionByUserId,
  getDriveConnectionByUserId,
} from '@/db/googleDriveConnections'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Refresh slightly before the actual expiry so a concurrent caller never gets
// a token that's already dead by the time it reaches Google.
const REFRESH_BUFFER_MS = 60_000

export class DriveAuthError extends Error {
  constructor(public reason: 'not_connected' | 'refresh_failed' | 'revoked') {
    super(reason)
    this.name = 'DriveAuthError'
  }
}

/**
 * Single chokepoint for every Google Drive API call. Reads the user's stored
 * connection, decrypts the access token if still valid, otherwise refreshes
 * via Google's token endpoint and persists the new ciphertext.
 *
 * Callers should treat a thrown DriveAuthError('revoked') as "the user must
 * reconnect" — the row has already been deleted by the time the error fires.
 */
export async function getValidDriveAccessToken(userId: number): Promise<string> {
  const conn = await getDriveConnectionByUserId(userId)
  if (!conn) throw new DriveAuthError('not_connected')

  const expiresAtMs =
    conn.expires_at instanceof Date ? conn.expires_at.getTime() : new Date(conn.expires_at).getTime()

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
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('[drive] GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET not set')
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
    // invalid_grant: refresh token was revoked or rotated. The connection is
    // dead; drop the row so the UI returns to the "Connect" state instead of
    // looping refresh failures.
    if (res.status === 400 && body.includes('invalid_grant')) {
      await deleteDriveConnectionByUserId(userId).catch(() => {})
      throw new DriveAuthError('revoked')
    }
    console.warn(`[drive] token refresh failed [userId=${userId}]: ${res.status} ${body.slice(0, 200)}`)
    throw new DriveAuthError('refresh_failed')
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  // Google usually does not rotate refresh tokens, but it can. Persist the
  // new one defensively when present so a future call doesn't suddenly fail.
  const updates: { access_token: string; expires_at: Date; refresh_token?: string } = {
    access_token: encryptSecret(data.access_token),
    expires_at: new Date(Date.now() + data.expires_in * 1000),
  }
  if (data.refresh_token) {
    updates.refresh_token = encryptSecret(data.refresh_token)
  }

  await db('google_drive_connections').where({ user_id: userId }).update(updates)

  return data.access_token
}
