import type { Knex } from 'knex'

/**
 * platform_whatsapp_inbound: one row per inbound message to the platform
 * number, keyed by Meta's message id. No content, no raw number.
 */

export type PlatformInboundKind = 'opt_out' | 'activation' | 'activation_rejected' | 'other'

const TABLE = 'platform_whatsapp_inbound'

/** True when this message is new; false for a redelivery (nothing else may happen). */
export async function recordPlatformInbound(
  trx: Knex.Transaction,
  row: {
    wamid: string
    kind: PlatformInboundKind
    fromHash: string | null
    messageTimestamp: number
    /** lib/whatsapp/platform/timestampSource.ts. Optional: omitted means unknown (NULL). */
    timestampSource?: 'meta' | 'server' | null
  },
): Promise<boolean> {
  const inserted = await trx(TABLE).insert(row).onConflict('wamid').ignore().returning('id')
  return inserted.length > 0
}

export async function setPlatformInboundKind(trx: Knex.Transaction, wamid: string, kind: PlatformInboundKind): Promise<void> {
  await trx(TABLE).where({ wamid }).update({ kind })
}

export async function countRecentRejectedActivations(trx: Knex.Transaction, fromHash: string): Promise<number> {
  const row = await trx(TABLE)
    .where({ fromHash, kind: 'activation_rejected' })
    .where('receivedAt', '>', trx.raw(`now() - interval '1 hour'`))
    .count<{ count: string }>('id as count')
    .first()
  return Number(row?.count ?? 0)
}

/** This sender has opted out at some point. A sender who did is never sent guidance. */
export async function hasEverOptedOut(trx: Knex.Transaction, fromHash: string): Promise<boolean> {
  return !!(await trx(TABLE).where({ fromHash, kind: 'opt_out' }).first('id'))
}

/** Another message from this sender was received in the last 24 hours (this one, `wamid`, excluded). */
export async function hasOtherInboundInLastDay(trx: Knex.Transaction, fromHash: string, wamid: string): Promise<boolean> {
  const row = await trx(TABLE)
    .where({ fromHash })
    .whereNot({ wamid })
    .where('receivedAt', '>', trx.raw(`now() - interval '24 hours'`))
    .first('id')
  return !!row
}

/** An opt-out from this sender sent at or after `messageTimestamp` (a tie counts). */
export async function hasOptOutAtOrAfter(trx: Knex.Transaction, fromHash: string, messageTimestamp: number): Promise<boolean> {
  const row = await trx(TABLE)
    .where({ fromHash, kind: 'opt_out' })
    .where('messageTimestamp', '>=', messageTimestamp)
    .first('id')
  return !!row
}
