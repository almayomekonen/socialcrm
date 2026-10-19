import { randomBytes } from 'node:crypto'
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

/** A new card. Any older pending card for this recipient is superseded first: one live card at a time. */
export async function createWaApproval(input: {
  recipientId: number
  agencyId: number
  userId: number
  jobId: number
  actionId: string
  argsHash: string
  now: Date
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(16).toString('hex')
  const expiresAt = new Date(input.now.getTime() + WA_APPROVAL_TTL_MS)
  await db.transaction(async (trx) => {
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
  })
  return { token, expiresAt }
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
