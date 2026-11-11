import 'server-only'
import { db } from '@/config/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { IntegrationConnection, IntegrationEnvironment, IssuerBusinessType } from '@/lib/integrations/core/types'

/**
 * smartbee_connections — one row per agency. Every read is BY AGENCY ID; there
 * is no read by any other key. The business token is decrypted here and only
 * here, and an undecryptable token reads as an invalid connection (never as a
 * usable one with an empty secret).
 */

const T = 'smartbee_connections'

type Row = {
  id: number | string
  agencyId: number
  ownerUserId: number
  environment: IntegrationEnvironment
  providerUserTokenEnc: string
  businessType: IssuerBusinessType
  status: IntegrationConnection['status']
}

export async function loadSmartbeeConnection(agencyId: number): Promise<IntegrationConnection | null> {
  const row = (await db(T).where({ agencyId }).first('id', 'agencyId', 'ownerUserId', 'environment', 'providerUserTokenEnc', 'businessType', 'status')) as Row | undefined
  if (!row) return null
  let secret = ''
  let status = row.status
  try {
    secret = decryptSecret(row.providerUserTokenEnc)
  } catch {
    status = status === 'disconnected' ? 'disconnected' : 'invalid'
  }
  if (!secret && status === 'active') status = 'invalid'
  return {
    id: Number(row.id),
    provider: 'smartbee',
    agencyId: Number(row.agencyId),
    ownerUserId: Number(row.ownerUserId),
    environment: row.environment,
    businessType: row.businessType,
    status,
    secret,
  }
}

/** The operator script's write (scripts/smartbee/connect.ts). The token is encrypted before it reaches the query. */
export async function saveSmartbeeConnection(input: {
  agencyId: number
  ownerUserId: number
  environment: IntegrationEnvironment
  businessType: IssuerBusinessType
  providerUserToken: string
  verifiedAt: Date
}): Promise<number> {
  const values = {
    agencyId: input.agencyId,
    ownerUserId: input.ownerUserId,
    environment: input.environment,
    businessType: input.businessType,
    providerUserTokenEnc: encryptSecret(input.providerUserToken),
    status: 'active',
    lastVerifiedAt: input.verifiedAt,
    lastError: null,
    updatedAt: db.fn.now(),
  }
  const [row] = await db(T).insert(values).onConflict('agencyId').merge().returning('id')
  return Number((row as { id: number | string }).id)
}

/** SmartBee answered 98: the business token no longer works. Every later operation stops until reconnected. */
export async function markSmartbeeConnectionInvalid(agencyId: number, reason: string): Promise<void> {
  await db(T).where({ agencyId, status: 'active' }).update({ status: 'invalid', lastError: reason.slice(0, 200), updatedAt: db.fn.now() })
}

/** Stops issuing. The row (and the block on native issuance it implies) stays until a person removes it. */
export async function disconnectSmartbee(agencyId: number): Promise<boolean> {
  const n = await db(T).where({ agencyId }).whereNot({ status: 'disconnected' }).update({ status: 'disconnected', updatedAt: db.fn.now() })
  return n > 0
}
