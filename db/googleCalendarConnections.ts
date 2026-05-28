import { db } from '@/config/db'

export type GoogleCalendarConnectionRow = {
  id: number
  user_id: number
  agency_id: number
  google_sub: string
  google_email: string
  access_token: string // ciphertext (AES-256-GCM, base64)
  refresh_token: string // ciphertext (AES-256-GCM, base64)
  expires_at: Date
  scope: string
  primary_calendar_id: string
  sync_status: 'active' | 'reauth_required' | 'disabled'
  last_error: string | null
  created_at: Date
}

export async function getCalendarConnectionByUserId(userId: number): Promise<GoogleCalendarConnectionRow | null> {
  const row = await db('google_calendar_connections').where({ user_id: userId }).first()
  return (row ?? null) as GoogleCalendarConnectionRow | null
}

export async function upsertCalendarConnection(input: {
  userId: number
  agencyId: number
  googleSub: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  expiresAt: Date
  scope: string
  primaryCalendarId?: string
}): Promise<void> {
  const merged = {
    agency_id: input.agencyId,
    google_sub: input.googleSub,
    google_email: input.googleEmail,
    access_token: input.encryptedAccessToken,
    refresh_token: input.encryptedRefreshToken,
    expires_at: input.expiresAt,
    scope: input.scope,
    primary_calendar_id: input.primaryCalendarId ?? 'primary',
    // A successful upsert brings the connection back to active and clears
    // any prior error — a fresh consent overrides a 'reauth_required'.
    sync_status: 'active' as const,
    last_error: null,
  }
  await db('google_calendar_connections')
    .insert({ user_id: input.userId, ...merged })
    .onConflict('user_id')
    .merge(merged)
}

export async function deleteCalendarConnectionByUserId(userId: number): Promise<void> {
  await db('google_calendar_connections').where({ user_id: userId }).delete()
}

export async function updateCalendarConnectionStatus(
  userId: number,
  status: 'active' | 'reauth_required' | 'disabled',
  lastError: string | null = null,
): Promise<void> {
  await db('google_calendar_connections').where({ user_id: userId }).update({ sync_status: status, last_error: lastError })
}
