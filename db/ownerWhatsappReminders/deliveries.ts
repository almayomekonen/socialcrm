import type { Knex } from 'knex'
import { db } from '@/config/db'
import { ACCOUNT_PAUSE_MS, REMINDER_CONVERSATION_LOCK_NAMESPACE, SENDING_LEASE_MS } from '@/lib/ownerWhatsappReminders/constants'
import { cooldownSql, eligibilitySql, windowBindings } from './candidates'

/**
 * The delivery lifecycle. Every transition is a guarded statement.
 *
 *   scheduled --claim--> sending --send--> sent | failed | unknown
 *   sending (lease expired) --reap--> unknown      (never resent)
 *   scheduled|sending --recheck fails--> cancelled (nothing was sent)
 *   sending --rate limited--> scheduled (later; bounded)
 */

const T = 'owner_whatsapp_reminder_deliveries'

export type ClaimedDelivery = {
  id: number
  reminderId: number
  recipientId: number
  agencyId: number
  conversationId: number
  attempts: number
  escalatedAt: Date
}

/** A send that may have reached Meta is never repeated: stale `sending` becomes `unknown`. */
export async function reapStaleSending(now: Date): Promise<number> {
  const rows = await db(T)
    .where({ status: 'sending' })
    .where('lockedAt', '<', new Date(now.getTime() - SENDING_LEASE_MS))
    .update({ status: 'unknown', errorCode: 'lease_expired', updatedAt: db.fn.now() })
    .returning('id')
  return rows.length
}

/** True while an account-wide rejection happened within the pause window. */
export async function isSendingPaused(now: Date): Promise<boolean> {
  const row = await db(T)
    .where({ status: 'failed', errorScope: 'account' })
    .where('updatedAt', '>=', new Date(now.getTime() - ACCOUNT_PAUSE_MS))
    .first('id')
  return !!row
}

/** Mark up to `limit` due deliveries `sending` (committed before any Graph call). */
export async function claimDueDeliveries(now: Date, limit: number): Promise<ClaimedDelivery[]> {
  const { rows } = await db.raw(
    `UPDATE ${T} d
        SET status = 'sending', attempts = d.attempts + 1, "lockedAt" = now(), "updatedAt" = now()
       FROM owner_whatsapp_reminders r
      WHERE r.id = d."reminderId"
        AND d.id IN (
          SELECT id FROM ${T}
           WHERE status = 'scheduled' AND "nextAttemptAt" <= :now
           ORDER BY "nextAttemptAt", id
           LIMIT :limit
           FOR UPDATE SKIP LOCKED
        )
      RETURNING d.id, d."reminderId", d."recipientId", d."agencyId", d."conversationId", d.attempts, r."escalatedAt"`,
    { now, limit },
  )
  return rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    reminderId: Number(r.reminderId),
    recipientId: Number(r.recipientId),
    agencyId: Number(r.agencyId),
    conversationId: Number(r.conversationId),
    attempts: Number(r.attempts),
    escalatedAt: new Date(r.escalatedAt as string),
  }))
}

export type LockedRecipient = { phoneE164: string }

/**
 * Inside the send transaction: take the per-conversation lock, re-check that the
 * hand-off is still the same, still unanswered and still eligible, that no other
 * reminder for the conversation went out in the cooldown, and LOCK the recipient
 * row (`FOR UPDATE`) while confirming it is still active, still in the agency
 * and still not suspended. A keyword or settings opt-out updates that same row,
 * so it waits for this transaction: a send can never follow a committed opt-out.
 * Returns the recipient's number, or the reason to cancel.
 */
export async function lockAndRecheck(
  trx: Knex.Transaction,
  d: ClaimedDelivery,
  agencyIds: number[],
  now: Date,
): Promise<{ ok: true; recipient: LockedRecipient } | { ok: false; reason: string }> {
  await trx.raw('SELECT pg_advisory_xact_lock(?::int, hashtext(?::text))', [REMINDER_CONVERSATION_LOCK_NAMESPACE, String(d.conversationId)])
  const recipient = await trx('owner_whatsapp_recipients as r')
    .where({ 'r.id': d.recipientId, 'r.agencyId': d.agencyId })
    .forUpdate()
    .first('r.status', 'r.phoneE164', 'r.userId')
  if (!recipient || recipient.status !== 'active' || !recipient.phoneE164) return { ok: false, reason: 'recipient_not_active' }
  const user = await trx('users').where({ id: recipient.userId, agencyId: d.agencyId }).whereRaw('suspended IS NOT TRUE').first('id')
  if (!user) return { ok: false, reason: 'recipient_user_inactive' }
  const { rows } = await trx.raw(
    `SELECT 1
       FROM conversation_ai_state ai
       JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
       LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
      WHERE cv.id = :conversationId AND cv."agencyId" = :agencyId AND ai."escalatedAt" = :escalatedAt
        AND ${eligibilitySql('cv', 'ai', 'c')}
        AND ${cooldownSql('cv', ':reminderId::bigint')}`,
    { ...windowBindings(now, agencyIds), conversationId: d.conversationId, agencyId: d.agencyId, escalatedAt: d.escalatedAt, reminderId: d.reminderId },
  )
  if (!rows.length) return { ok: false, reason: 'no_longer_eligible' }
  return { ok: true, recipient: { phoneE164: recipient.phoneE164 } }
}

type Outcome =
  | { status: 'sent'; wamid: string }
  | { status: 'unknown'; errorCode: string }
  | { status: 'failed'; errorCode: string | null; errorScope: 'recipient' | 'account' | 'other' | 'rate_limit' }
  | { status: 'scheduled'; nextAttemptAt: Date; errorCode: string | null; errorScope: 'rate_limit' | null }
  | { status: 'cancelled'; cancelReason: string }

export async function recordOutcome(q: Knex | Knex.Transaction, id: number, o: Outcome): Promise<void> {
  const base = { status: o.status, lockedAt: null, updatedAt: q.fn.now() }
  const extra =
    o.status === 'sent' ? { wamid: o.wamid, sentAt: q.fn.now(), errorCode: null, errorScope: null }
    : o.status === 'unknown' ? { errorCode: o.errorCode }
    : o.status === 'failed' ? { errorCode: o.errorCode, errorScope: o.errorScope }
    : o.status === 'scheduled' ? { nextAttemptAt: o.nextAttemptAt, errorCode: o.errorCode, errorScope: o.errorScope }
    : { cancelReason: o.cancelReason }
  await q(T).where({ id, status: 'sending' }).update({ ...base, ...extra })
}

/** Close reminders whose deliveries are all terminal: done, or cancelled when nothing was attempted. */
export async function finalizeReminders(): Promise<void> {
  await db.raw(
    `UPDATE owner_whatsapp_reminders r
        SET status = CASE WHEN EXISTS (SELECT 1 FROM ${T} d WHERE d."reminderId" = r.id AND d.status <> 'cancelled')
                          THEN 'done' ELSE 'cancelled' END,
            "cancelReason" = CASE WHEN EXISTS (SELECT 1 FROM ${T} d WHERE d."reminderId" = r.id AND d.status <> 'cancelled')
                                  THEN NULL ELSE 'all_deliveries_cancelled' END,
            "updatedAt" = now()
      WHERE r.status = 'scheduled'
        AND NOT EXISTS (SELECT 1 FROM ${T} d WHERE d."reminderId" = r.id AND d.status IN ('scheduled','sending'))`,
  )
}
