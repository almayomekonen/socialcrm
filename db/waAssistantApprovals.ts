import { randomBytes } from 'node:crypto'
import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * wa_assistant_approvals: the single-use token behind a WhatsApp confirmation
 * button. It names ONE recipient and ONE pending agent action with the exact
 * argsHash the owner was shown. Every decision is a guarded transition out of
 * `pending`; nothing here executes an action.
 */

const T = 'wa_assistant_approvals'
export const WA_APPROVAL_TTL_MS = 15 * 60 * 1000

export type WaApproval = {
  id: number
  token: string
  recipientId: number
  agencyId: number
  userId: number
  actionId: string
  argsHash: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'superseded'
  expiresAt: Date
}

type CreateInput = {
  recipientId: number
  agencyId: number
  userId: number
  jobId: number
  actionId: string
  argsHash: string
  now: Date
  /** Default WA_APPROVAL_TTL_MS. */
  ttlMs?: number
}

/** A creation path found no recipient row to lock. A scoped job always has one. */
export class WaApprovalRecipientMissingError extends Error {
  constructor(recipientId: number) {
    super(`wa_assistant_approvals: recipient ${recipientId} not found`)
    this.name = 'WaApprovalRecipientMissingError'
  }
}

/**
 * THE SERIALIZATION POINT for every token creation (architecture v1.6.1): the
 * recipient row, FOR UPDATE, before any approval row is touched. Locking the
 * recipient's pending tokens would not serialize two creators when there are
 * none. Global order: recipient (L1) → reminder rows (L2) → approval rows (LA).
 * The partial unique index `wa_approvals_one_pending_per_recipient` is the
 * database backstop for any path that forgets this.
 */
async function lockRecipient(trx: Knex.Transaction, recipientId: number): Promise<boolean> {
  const row = await trx('owner_whatsapp_recipients').where({ id: recipientId }).forUpdate().first('id')
  return !!row
}

async function insertSuperseding(trx: Knex.Transaction, input: CreateInput, token: string, expiresAt: Date): Promise<void> {
  await trx(T).where({ recipientId: input.recipientId, status: 'pending' }).update({ status: 'superseded', updatedAt: trx.fn.now() })
  await trx(T).insert({
    token,
    recipientId: input.recipientId,
    agencyId: input.agencyId,
    userId: input.userId,
    jobId: input.jobId,
    actionId: input.actionId,
    argsHash: input.argsHash,
    expiresAt,
  })
}

/** A new card. Any older pending card for this recipient is superseded first: one live card at a time. */
export async function createWaApproval(input: CreateInput): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(16).toString('hex')
  const expiresAt = new Date(input.now.getTime() + (input.ttlMs ?? WA_APPROVAL_TTL_MS))
  await db.transaction(async (trx) => {
    if (!(await lockRecipient(trx, input.recipientId))) throw new WaApprovalRecipientMissingError(input.recipientId)
    await insertSuperseding(trx, input, token, expiresAt)
  })
  return { token, expiresAt }
}

export const REMINDER_ACTION_PREFIX = 'rem_'

export type EnsureApprovalResult =
  | { kind: 'created' | 'existing_pending'; token: string; expiresAt: Date }
  | { kind: 'already_decided'; status: 'approved' }
  | { kind: 'terminal'; status: 'rejected' | 'expired' | 'superseded' }
  | { kind: 'no_recipient' }

type ActionTokenRow = { token: string; status: WaApproval['status']; expiresAt: Date; argsHash: string }

/**
 * The approval token for ONE reminder action, for its whole lifetime (v1.6).
 * A token is never issued twice for the same action:
 *   pending, not expired  → the same token
 *   pending, expired      → marked expired, then `terminal`
 *   approved              → `already_decided`, no token
 *   rejected / expired / superseded → `terminal`, no token
 *   none                  → supersede the recipient's other pending cards, insert
 * Concurrent callers are serialized on the recipient row, so the second sees the
 * first's row and returns its logical result instead of a unique violation.
 */
export async function ensureWaApprovalForAction(input: CreateInput): Promise<EnsureApprovalResult> {
  if (!input.actionId.startsWith(REMINDER_ACTION_PREFIX)) throw new Error('ensureWaApprovalForAction: reminder action ids only')
  return db.transaction(async (trx) => {
    if (!(await lockRecipient(trx, input.recipientId))) return { kind: 'no_recipient' as const }
    const existing = (await trx(T).where({ actionId: input.actionId }).forUpdate().first('token', 'status', 'expiresAt', 'argsHash')) as
      | ActionTokenRow
      | undefined
    if (existing) return resultFor(trx, input, existing)

    const token = randomBytes(16).toString('hex')
    const expiresAt = new Date(input.now.getTime() + WA_APPROVAL_TTL_MS)
    await trx(T).where({ recipientId: input.recipientId, status: 'pending' }).update({ status: 'superseded', updatedAt: trx.fn.now() })
    const { rows } = await trx.raw(
      `INSERT INTO ${T} (token, "recipientId", "agencyId", "userId", "jobId", "actionId", "argsHash", "expiresAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ("actionId") WHERE "actionId" LIKE 'rem\\_%' DO NOTHING
       RETURNING token`,
      [token, input.recipientId, input.agencyId, input.userId, input.jobId, input.actionId, input.argsHash, expiresAt],
    )
    if (rows.length === 1) return { kind: 'created' as const, token, expiresAt }
    // Backstop only: the recipient lock already serializes callers of this action.
    const winner = (await trx(T).where({ actionId: input.actionId }).first('token', 'status', 'expiresAt', 'argsHash')) as ActionTokenRow
    return resultFor(trx, input, winner)
  })
}

async function resultFor(trx: Knex.Transaction, input: CreateInput, row: ActionTokenRow): Promise<EnsureApprovalResult> {
  if (row.argsHash !== input.argsHash) throw new Error('ensureWaApprovalForAction: one action id, two argument sets')
  const expiresAt = new Date(row.expiresAt)
  if (row.status === 'pending') {
    if (expiresAt > input.now) return { kind: 'existing_pending', token: row.token, expiresAt }
    await trx(T).where({ actionId: input.actionId, status: 'pending' }).update({ status: 'expired', updatedAt: trx.fn.now() })
    return { kind: 'terminal', status: 'expired' }
  }
  if (row.status === 'approved') return { kind: 'already_decided', status: 'approved' }
  return { kind: 'terminal', status: row.status }
}

export type DecideResult =
  | { ok: true; approval: WaApproval }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_decided' | 'superseded' }

/**
 * Consume a token for THIS recipient. Exactly one caller can move it out of
 * `pending`; a replay, a token from another phone, an expired or superseded
 * card all come back `ok: false` and change nothing (an expired one is marked).
 */
export async function decideWaApproval(input: { token: string; recipientId: number; decision: 'approved' | 'rejected'; now: Date }): Promise<DecideResult> {
  const updated = (await db(T)
    .where({ token: input.token, recipientId: input.recipientId, status: 'pending' })
    .where('expiresAt', '>', input.now)
    .update({ status: input.decision, decidedAt: input.now, updatedAt: db.fn.now() })
    .returning(['id', 'token', 'recipientId', 'agencyId', 'userId', 'actionId', 'argsHash', 'status', 'expiresAt'])) as WaApproval[]
  if (updated.length === 1) return { ok: true, approval: { ...updated[0], id: Number(updated[0].id), recipientId: Number(updated[0].recipientId) } }

  const row = (await db(T).where({ token: input.token, recipientId: input.recipientId }).first('status', 'expiresAt')) as
    | { status: WaApproval['status']; expiresAt: Date }
    | undefined
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status === 'pending') {
    await db(T).where({ token: input.token, status: 'pending' }).update({ status: 'expired', updatedAt: db.fn.now() })
    return { ok: false, reason: 'expired' }
  }
  if (row.status === 'expired') return { ok: false, reason: 'expired' }
  if (row.status === 'superseded') return { ok: false, reason: 'superseded' }
  return { ok: false, reason: 'already_decided' }
}

/** Read-only: the card behind a token, for THIS recipient only. */
export async function peekWaApproval(token: string, recipientId: number): Promise<WaApproval | null> {
  const row = (await db(T)
    .where({ token, recipientId })
    .first('id', 'token', 'recipientId', 'agencyId', 'userId', 'actionId', 'argsHash', 'status', 'expiresAt')) as WaApproval | undefined
  return row ? { ...row, id: Number(row.id), recipientId: Number(row.recipientId), expiresAt: new Date(row.expiresAt) } : null
}

/** Is a card waiting for this recipient right now? (A typed "כן" is pointed at the button.) */
export async function hasLiveWaApproval(recipientId: number, now: Date): Promise<boolean> {
  const row = await db(T).where({ recipientId, status: 'pending' }).where('expiresAt', '>', now).first('id')
  return !!row
}
