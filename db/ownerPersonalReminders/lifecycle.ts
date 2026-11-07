import type { Knex } from 'knex'
import { db } from '@/config/db'
import { RATE_LIMIT_BACKOFF_MS } from '@/lib/ownerWhatsappReminders/constants'
import {
  REMINDER_CLAIM_LEASE_MS,
  REMINDER_DISPATCH_LEASE_MS,
  REMINDER_MAX_LATENESS_MS,
  REMINDER_TEXT_RETENTION_MS,
} from '@/lib/flags/personalReminderFlags'
import type { PlatformTextOutcome } from '@/lib/whatsapp/platform/sendText'
import { insertReminderEvents, type ReminderEvent } from './events'
import { readSendControls } from './controls'
import { releaseAll, reservationPlan } from './capacity'
import { notifyOwnerReminderNotDelivered } from './notifyOwner'

/**
 * The delivery lifecycle around the gate (architecture v1.2 §3, T1/T3/T10/T11/T13):
 *
 *   scheduled --claim (SKIP LOCKED)--> claimed --gate--> dispatching --Graph--> sent | failed | unknown
 *   claimed past its lease     --> scheduled   (nothing was sent: safe to retry)
 *   dispatching past its lease --> unknown     (may have reached Meta: NEVER resent)
 *
 * Every transition is a guarded statement. Background sweeps take rows
 * `FOR UPDATE SKIP LOCKED` and never wait. No transaction is open during a Graph call.
 */

const T = 'owner_personal_reminders'

export type Claimed = { id: number; claimToken: string }

/** T1: claim up to `limit` due reminders. Commits before the gate runs. */
export async function claimDueReminders(nowMs: number, limit: number): Promise<Claimed[]> {
  const { rows } = await db.raw(
    `UPDATE ${T} r
        SET status = 'claimed', "claimToken" = gen_random_uuid(), "claimedAt" = :now, attempts = r.attempts + 1, "updatedAt" = now()
      WHERE r.id IN (
        SELECT q.id FROM ${T} q
         WHERE q.status = 'scheduled' AND q."nextAttemptAt" <= :now
         ORDER BY q."nextAttemptAt", q.id
         LIMIT :limit
         FOR UPDATE SKIP LOCKED)
      RETURNING r.id, r."claimToken"`,
    { now: new Date(nowMs), limit },
  )
  return rows.map((r: { id: string | number; claimToken: string }) => ({ id: Number(r.id), claimToken: String(r.claimToken) }))
}

/** T10: a claim the gate never finished. Nothing was dispatched, so it is safe to return. */
export async function reapStaleClaims(nowMs: number): Promise<number> {
  const { rows } = await db.raw(
    `UPDATE ${T} r SET status = 'scheduled', "claimToken" = NULL, "claimedAt" = NULL, "updatedAt" = now()
      WHERE r.id IN (SELECT q.id FROM ${T} q WHERE q.status = 'claimed' AND q."claimedAt" < :before FOR UPDATE SKIP LOCKED)
      RETURNING r.id`,
    { before: new Date(nowMs - REMINDER_CLAIM_LEASE_MS) },
  )
  return rows.length
}

/** T11: a dispatch whose outcome was never recorded may have reached Meta. It becomes `unknown`, never resent. */
export async function reapStaleDispatches(nowMs: number): Promise<number> {
  return db.transaction(async (trx) => {
    const { rows } = await trx.raw(
      `UPDATE ${T} r SET status = 'unknown', "finalizedAt" = :now, "updatedAt" = now()
        WHERE r.id IN (SELECT q.id FROM ${T} q WHERE q.status = 'dispatching' AND q."dispatchedAt" < :before FOR UPDATE SKIP LOCKED)
        RETURNING r.id, r."agencyId", r."userId", r."recipientId", r."remindAt"`,
      { now: new Date(nowMs), before: new Date(nowMs - REMINDER_DISPATCH_LEASE_MS) },
    )
    await insertReminderEvents(trx, rows.map((r: Record<string, unknown>) => event(r, 'unknown', 'dispatching', 'unknown', 'lease_expired')))
    for (const r of rows as Record<string, unknown>[]) await notifyOwner(trx, r, 'unknown', nowMs)
    return rows.length
  })
}

/** R9: the owner's in-app notice, in this transaction (./notifyOwner.ts). */
const notifyOwner = (trx: Knex.Transaction, r: Record<string, unknown>, kind: 'failed' | 'unknown', nowMs: number) =>
  notifyOwnerReminderNotDelivered(trx, { id: Number(r.id), agencyId: Number(r.agencyId), userId: Number(r.userId), remindAt: r.remindAt as string }, kind, nowMs)

function event(r: Record<string, unknown>, type: ReminderEvent['type'], from: string, to: string, reason: string | null = null, errorCode: number | null = null): ReminderEvent {
  return { agencyId: Number(r.agencyId), userId: Number(r.userId), recipientId: Number(r.recipientId), reminderId: Number(r.id), actorKind: 'system', type, fromStatus: from, toStatus: to, reason, errorCode }
}

async function releaseFor(trx: Knex.Transaction, r: Record<string, unknown>) {
  const c = await readSendControls(trx)
  if (!c?.billingTimezone || r.reservedMicros === null || r.dispatchedAt === null) return
  const plan = reservationPlan(c, { agencyId: Number(r.agencyId), recipientId: Number(r.recipientId) }, new Date(r.dispatchedAt as string).getTime(), Number(r.reservedMicros))
  await releaseAll(trx, plan)
}

const WINDOW_CODES = new Set(['131047', '470'])

/**
 * T3: record what Meta answered, only for the dispatch THIS claim made.
 *   sent      → `sent` + wamid; reservation kept
 *   unknown   → `unknown`;      reservation kept; never resent
 *   rejected  → reservation released (definite non-delivery), then:
 *               rate limit, retries left and still in time → `scheduled` again
 *               131047 / 470 → `failed` window_closed; otherwise failed by scope
 */
export async function recordSendOutcome(input: { reminderId: number; claimToken: string; outcome: PlatformTextOutcome; nowMs: number }): Promise<string> {
  return db.transaction(async (trx) => {
    const r = (await trx(T)
      .where({ id: input.reminderId, status: 'dispatching', claimToken: input.claimToken })
      .forUpdate()
      .first('id', 'agencyId', 'userId', 'recipientId', 'attempts', 'remindAt', 'dispatchedAt', 'reservedMicros')) as Record<string, unknown> | undefined
    if (!r) return 'not_dispatching'
    const now = new Date(input.nowMs)
    const o = input.outcome
    if (o.kind === 'sent') {
      await trx(T).where({ id: r.id }).update({ status: 'sent', wamid: o.wamid, sentAt: now, finalizedAt: now, updatedAt: trx.fn.now() })
      await insertReminderEvents(trx, [event(r, 'sent', 'dispatching', 'sent')])
      return 'sent'
    }
    if (o.kind === 'unknown') {
      await trx(T).where({ id: r.id }).update({ status: 'unknown', finalizedAt: now, updatedAt: trx.fn.now() })
      await insertReminderEvents(trx, [event(r, 'unknown', 'dispatching', 'unknown', o.reason)])
      await notifyOwner(trx, r, 'unknown', input.nowMs)
      return 'unknown'
    }
    const code = o.code && /^\d+$/.test(o.code) ? Number(o.code) : null
    await releaseFor(trx, r)
    const attempts = Number(r.attempts)
    const wait = RATE_LIMIT_BACKOFF_MS[attempts - 1]
    const nextAt = wait !== undefined ? input.nowMs + wait : null
    if (o.scope === 'rate_limit' && nextAt !== null && nextAt - new Date(r.remindAt as string).getTime() <= REMINDER_MAX_LATENESS_MS) {
      await trx(T)
        .where({ id: r.id })
        .update({
          status: 'scheduled', nextAttemptAt: new Date(nextAt), claimToken: null, claimedAt: null, dispatchedAt: null,
          reservedMicros: null, rateCardId: null, costReleasedAt: null, errorCode: code, errorScope: 'rate_limit', updatedAt: trx.fn.now(),
        })
      await insertReminderEvents(trx, [event(r, 'cost_released', 'dispatching', 'scheduled', 'rate_limited', code)])
      return 'retry'
    }
    const reason = WINDOW_CODES.has(o.code ?? '')
      ? 'window_closed'
      : o.scope === 'rate_limit' ? 'rate_limited' : o.scope === 'recipient' ? 'recipient_rejected' : o.scope === 'account' ? 'account_rejected' : 'other'
    await trx(T)
      .where({ id: r.id })
      .update({ status: 'failed', failureReason: reason, errorCode: code, errorScope: o.scope, finalizedAt: now, costReleasedAt: now, updatedAt: trx.fn.now() })
    await insertReminderEvents(trx, [event(r, 'failed', 'dispatching', 'failed', reason, code), event(r, 'cost_released', 'failed', 'failed', reason, code)])
    await notifyOwner(trx, r, 'failed', input.nowMs)
    return 'failed'
  })
}

/** Meta reported `failed` for a reminder it had accepted: not delivered, so not billed. Released once. */
export async function releaseForFailedStatuses(limit = 50): Promise<number> {
  const ids = (await db(`${T} as r`)
    .join('owner_whatsapp_message_status as s', 's.wamid', 'r.wamid')
    .where('r.status', 'sent')
    .where('s.status', 'failed')
    .whereNull('r.costReleasedAt')
    .limit(limit)
    .pluck('r.id')) as (string | number)[]
  let released = 0
  for (const id of ids) {
    await db.transaction(async (trx) => {
      const r = (await trx(T).where({ id, status: 'sent' }).whereNull('costReleasedAt').forUpdate().skipLocked()
        .first('id', 'agencyId', 'userId', 'recipientId', 'dispatchedAt', 'reservedMicros', 'remindAt')) as Record<string, unknown> | undefined
      if (!r) return
      await releaseFor(trx, r)
      await trx(T).where({ id: r.id }).update({ costReleasedAt: trx.fn.now(), updatedAt: trx.fn.now() })
      await insertReminderEvents(trx, [event(r, 'cost_released', 'sent', 'sent', 'meta_failed_status')])
      // Meta accepted it, then reported it failed: definitely not delivered.
      await notifyOwner(trx, r, 'failed', Date.now())
      released++
    })
  }
  return released
}

/** T13: reminder text is cleared 90 days after a terminal state (approved, B10). Events never held it. */
export async function purgeReminderText(nowMs: number, limit = 500): Promise<number> {
  return db.transaction(async (trx) => {
    const { rows } = await trx.raw(
      `UPDATE ${T} r SET text = NULL, "textPurgedAt" = :now, "updatedAt" = now()
        WHERE r.id IN (
          SELECT q.id FROM ${T} q
           WHERE q.text IS NOT NULL AND q."finalizedAt" < :before
             AND q.status IN ('sent','failed','unknown','cancelled','discarded')
           LIMIT :limit FOR UPDATE SKIP LOCKED)
        RETURNING r.id, r."agencyId", r."userId", r."recipientId", r.status`,
      { now: new Date(nowMs), before: new Date(nowMs - REMINDER_TEXT_RETENTION_MS), limit },
    )
    await insertReminderEvents(trx, rows.map((r: Record<string, unknown>) => event(r, 'text_purged', String(r.status), String(r.status))))
    return rows.length
  })
}
