import { db } from '@/config/db'
import { parseGrantedScopes } from '@/db/facebook'
import { resolvePageAccessToken, sealPageAccessToken } from '@/lib/facebook/pageToken'

/**
 * The user access token behind ad reporting, one per (agency, user).
 *
 * Sealed with the same AES-256-GCM helper as Page tokens (the seal format is
 * token-type agnostic). Read only by the server, only for the CURRENT user.
 */

export type AdConnection = {
  id: number
  token: string
  grantedScopes: string[]
  tokenExpiresAt: Date | null
}

export async function saveAdConnection(input: {
  agencyId: number
  userId: number
  accessToken: string
  grantedScopes: string[]
  expiresInSeconds: number | null
}): Promise<void> {
  const now = new Date()
  const tokenExpiresAt = input.expiresInSeconds ? new Date(now.getTime() + input.expiresInSeconds * 1000) : null
  const row = {
    accessToken: sealPageAccessToken(input.accessToken),
    grantedScopes: JSON.stringify(input.grantedScopes),
    tokenExpiresAt,
    updatedAt: now,
  }
  await db('facebook_ad_connections')
    .insert({ agencyId: input.agencyId, userId: input.userId, ...row })
    .onConflict(['agencyId', 'userId'])
    .merge(row)
}

/** Null when the user never connected. Throws only if a stored seal cannot be opened. */
export async function getAdConnection(agencyId: number, userId: number): Promise<AdConnection | null> {
  const row = await db('facebook_ad_connections').where({ agencyId, userId }).first()
  if (!row) return null
  return {
    id: Number(row.id),
    token: resolvePageAccessToken(row.accessToken),
    grantedScopes: parseGrantedScopes(row.grantedScopes),
    tokenExpiresAt: row.tokenExpiresAt ? new Date(row.tokenExpiresAt) : null,
  }
}

export async function deleteAdConnection(agencyId: number, userId: number): Promise<void> {
  await db('facebook_ad_connections').where({ agencyId, userId }).del()
}
