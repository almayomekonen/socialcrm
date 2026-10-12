import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * owner_whatsapp_recipients: every state change is one guarded statement.
 *
 *   pending   -> active     only `activateByCode` (a live code, from the phone)
 *   any       -> opted_out  `optOutByPhone` (keyword) or `optOutOwnRow` (settings)
 *   opted_out -> pending    only `startOwnActivation` (new consent in settings)
 *
 * Nothing here sends anything.
 */

export type RecipientStatus = 'pending' | 'active' | 'opted_out'

export type OwnRecipientRow = {
  status: RecipientStatus
  phoneE164: string | null
  activationExpiresAt: Date | null
  verifiedAt: Date | null
  optedOutAt: Date | null
}

const TABLE = 'owner_whatsapp_recipients'

export async function getOwnRecipient(agencyId: number, userId: number): Promise<OwnRecipientRow | null> {
  const row = await db(TABLE)
    .where({ agencyId, userId })
    .first('status', 'phoneE164', 'activationExpiresAt', 'verifiedAt', 'optedOutAt')
  return row ?? null
}

/**
 * Record consent and issue a code for the session's own row. Refused (null)
 * while the row is active: the user turns it off first. Keeps the last
 * verified number, so a keyword opt-out from it still applies to the new
 * pending row; clears the previous activation time, so only the new code can
 * activate it.
 */
export async function startOwnActivation(input: {
  agencyId: number
  userId: number
  codeHash: string
  expiresAt: Date
  consentTextVersion: string
}): Promise<'started' | 'already_active'> {
  const fields = {
    status: 'pending',
    consentAt: db.fn.now(),
    consentTextVersion: input.consentTextVersion,
    consentSource: 'settings',
    activationCodeHash: input.codeHash,
    activationExpiresAt: input.expiresAt,
    activationMessageTimestamp: null,
    updatedAt: db.fn.now(),
  }
  const rows = await db(TABLE)
    .insert({ agencyId: input.agencyId, userId: input.userId, ...fields })
    .onConflict(['agencyId', 'userId'])
    .merge(fields)
    .where(`${TABLE}.status`, '<>', 'active')
    .returning('id')
  return rows.length ? 'started' : 'already_active'
}

/** Settings opt-out of the session's own row. Idempotent. */
export async function optOutOwnRow(agencyId: number, userId: number): Promise<boolean> {
  const rows = await db(TABLE)
    .where({ agencyId, userId })
    .whereIn('status', ['pending', 'active'])
    .update({
      status: 'opted_out',
      optedOutAt: db.fn.now(),
      optOutSource: 'settings',
      activationCodeHash: null,
      activationExpiresAt: null,
      updatedAt: db.fn.now(),
    })
    .returning('id')
  return rows.length > 0
}

/**
 * Keyword opt-out from a verified number, across every agency (it is the
 * person's choice, not the agency's). Applies to rows activated at or before
 * the opt-out's own send time; a row activated by a LATER message keeps its
 * state. A tie goes to the opt-out.
 */
export async function optOutByPhone(trx: Knex.Transaction, phoneE164: string, messageTimestamp: number): Promise<number> {
  const rows = await trx(TABLE)
    .where({ phoneE164 })
    .whereIn('status', ['pending', 'active'])
    .where((q) => q.whereNull('activationMessageTimestamp').orWhere('activationMessageTimestamp', '<=', messageTimestamp))
    .update({
      status: 'opted_out',
      optedOutAt: trx.fn.now(),
      optOutSource: 'keyword',
      activationCodeHash: null,
      activationExpiresAt: null,
      updatedAt: trx.fn.now(),
    })
    .returning('id')
  return rows.length
}

/**
 * Consume a live code and bind the number Meta reported, in one statement, so a
 * code activates at most once. Only for an allowlisted agency, and only while
 * the user still belongs to it and is not suspended.
 */
export async function activateByCode(
  trx: Knex.Transaction,
  input: { codeHash: string; phoneE164: string; messageTimestamp: number; agencyIds: number[] },
): Promise<{ agencyId: number; userId: number } | null> {
  if (!input.agencyIds.length) return null
  const { rows } = await trx.raw(
    `UPDATE ${TABLE} r
        SET status = 'active', "phoneE164" = ?, "verifiedAt" = now(), "activationMessageTimestamp" = ?,
            "activationCodeHash" = NULL, "activationExpiresAt" = NULL, "updatedAt" = now()
      WHERE r."activationCodeHash" = ?
        AND r."activationExpiresAt" > now()
        AND r.status = 'pending'
        AND r."agencyId" = ANY(?::int[])
        AND EXISTS (SELECT 1 FROM users u
                     WHERE u.id = r."userId" AND u."agencyId" = r."agencyId" AND u.suspended IS NOT TRUE)
      RETURNING r."agencyId", r."userId"`,
    [input.phoneE164, input.messageTimestamp, input.codeHash, `{${input.agencyIds.join(',')}}`],
  )
  const row = rows[0]
  return row ? { agencyId: Number(row.agencyId), userId: Number(row.userId) } : null
}
