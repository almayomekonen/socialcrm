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
  /** The account this user last chose. A hint only — always re-verified against `/me/adaccounts`. */
  selectedAccountId: string | null
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
    selectedAccountId: typeof row.selectedAccountId === 'string' && row.selectedAccountId ? row.selectedAccountId : null,
  }
}

/**
 * Remember the account a user chose. Called only AFTER the server verified the
 * id against the accounts Meta lists for this connection's token; scoped to the
 * (agency, user) row, so it can never touch another user's connection.
 */
export async function setSelectedAdAccount(agencyId: number, userId: number, accountId: string): Promise<void> {
  if (!/^act_\d+$/.test(accountId)) return
  await db('facebook_ad_connections')
    .where({ agencyId, userId })
    .whereRaw(`"selectedAccountId" IS DISTINCT FROM ?`, [accountId])
    .update({ selectedAccountId: accountId, updatedAt: new Date() })
}

export async function deleteAdConnection(agencyId: number, userId: number): Promise<void> {
  await db('facebook_ad_connections').where({ agencyId, userId }).del()
}
