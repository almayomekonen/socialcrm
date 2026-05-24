import { db } from '@/config/db'

export type GoogleDriveConnectionRow = {
  id: number
  user_id: number
  agency_id: number
  google_sub: string
  google_email: string
  access_token: string // ciphertext (AES-256-GCM, base64)
  refresh_token: string // ciphertext (AES-256-GCM, base64)
  expires_at: Date
  scope: string
  created_at: Date
}

export async function getDriveConnectionByUserId(userId: number): Promise<GoogleDriveConnectionRow | null> {
  const row = await db('google_drive_connections').where({ user_id: userId }).first()
  return (row ?? null) as GoogleDriveConnectionRow | null
}

export async function upsertDriveConnection(input: {
  userId: number
  agencyId: number
  googleSub: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  expiresAt: Date
  scope: string
}): Promise<void> {
  await db('google_drive_connections')
    .insert({
      user_id: input.userId,
      agency_id: input.agencyId,
      google_sub: input.googleSub,
      google_email: input.googleEmail,
      access_token: input.encryptedAccessToken,
      refresh_token: input.encryptedRefreshToken,
      expires_at: input.expiresAt,
      scope: input.scope,
    })
    .onConflict('user_id')
    .merge({
      agency_id: input.agencyId,
      google_sub: input.googleSub,
      google_email: input.googleEmail,
      access_token: input.encryptedAccessToken,
      refresh_token: input.encryptedRefreshToken,
      expires_at: input.expiresAt,
      scope: input.scope,
    })
}

export async function deleteDriveConnectionByUserId(userId: number): Promise<void> {
  await db('google_drive_connections').where({ user_id: userId }).delete()
}
