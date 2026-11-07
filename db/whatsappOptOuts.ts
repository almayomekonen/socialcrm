import type { Knex } from 'knex'
import { db } from '@/config/db'
import { skipPendingAutomatedRepliesForCustomer } from './optOutPendingJobs'
import type { OptOutCommand } from '@/lib/whatsapp/optOut/command'

/**
 * WhatsApp opt-out store: the current state per (business, customer number) and
 * its append-only event history. Migration 20261107120000.
 *
 * LOCK. Every write takes the EXCLUSIVE advisory lock on the (agency, number)
 * key, and every gated send holds the SHARED lock on the same key from the
 * opt-out check until the provider request has returned
 * (lib/whatsapp/optOut/sendGate.ts). The two exclude each other, so a provider
 * request can never begin after an opt-out transaction has taken the lock.
 * The recording transaction takes no other lock before this one, so it cannot
 * form a cycle with a send.
 */

export const OPT_OUT_LOCK_NAMESPACE = 20261107

export type OptOutStatus = 'opted_out' | 'opted_in'
export type OptOutCommandOutcome = 'applied' | 'stale' | 'already_in_state' | 'no_active_opt_out' | 'duplicate'

export function optOutLockKey(agencyId: number, customerPhoneE164: string): string {
  return `${agencyId}:${customerPhoneE164}`
}

export async function lockOptOutKeyExclusive(trx: Knex.Transaction, agencyId: number, phone: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?::int, hashtext(?::text))', [OPT_OUT_LOCK_NAMESPACE, optOutLockKey(agencyId, phone)])
}

export async function lockOptOutKeyShared(trx: Knex.Transaction, agencyId: number, phone: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock_shared(?::int, hashtext(?::text))', [
    OPT_OUT_LOCK_NAMESPACE,
    optOutLockKey(agencyId, phone),
  ])
}

export async function readOptOutStatus(
  conn: Knex | Knex.Transaction,
  agencyId: number,
  phone: string,
): Promise<OptOutStatus | null> {
  const row = await conn('whatsapp_opt_outs').where({ agencyId, customerPhoneE164: phone }).first('status')
  return (row?.status as OptOutStatus | undefined) ?? null
}

/** A plain read, for a fast early answer. The authoritative check is the gate's, under the lock. */
export async function isCustomerOptedOut(agencyId: number, phone: string): Promise<boolean> {
  return (await readOptOutStatus(db, agencyId, phone)) === 'opted_out'
}

/**
 * Record one inbound opt-out or re-opt-in command, in its own short transaction.
 *
 * ORDERING. `eventAt` is the customer message's own timestamp.
 *  - opt_out: always wins unless it is older than the event that set the current
 *    status (then `stale`). Already opted out: `already_in_state`.
 *  - opt_in: applies only when an ACTIVE opt-out exists (else `no_active_opt_out`)
 *    and only when it is strictly newer than that opt-out. A tie goes to the
 *    opt-out (`stale`).
 *  - A redelivery of the same message (`messageExternalId`) is `duplicate` and
 *    writes nothing.
 * Re-opting in never deletes the row or clears `firstOptedOutAt`.
 */
export async function recordInboundOptOutCommand(input: {
  agencyId: number
  customerPhoneE164: string
  command: OptOutCommand
  eventAt: Date
  messageExternalId: string
}, deps: { skipPendingJobs: typeof skipPendingAutomatedRepliesForCustomer } = { skipPendingJobs: skipPendingAutomatedRepliesForCustomer }): Promise<{
  outcome: OptOutCommandOutcome
  eventId: number | null
  /** Pending automated replies ended as skipped/opted_out; null when the cancellation failed. */
  skippedPendingJobs: number | null
}> {
  const { agencyId, customerPhoneE164: phone, command, eventAt, messageExternalId } = input
  return db.transaction(async (trx) => {
    await lockOptOutKeyExclusive(trx, agencyId, phone)

    const seen = await trx('whatsapp_opt_out_events').where({ agencyId, messageExternalId }).first('id')
    if (seen) return { outcome: 'duplicate' as const, eventId: null, skippedPendingJobs: 0 }

    const row = await trx('whatsapp_opt_outs')
      .where({ agencyId, customerPhoneE164: phone })
      .forUpdate()
      .first('id', 'status', 'lastEventAt')
    const last = row ? new Date(row.lastEventAt).getTime() : null
    const at = eventAt.getTime()

    let outcome: Exclude<OptOutCommandOutcome, 'duplicate'>
    if (command === 'opt_out') {
      if (!row) outcome = 'applied'
      else if (last != null && at < last) outcome = 'stale'
      else if (row.status === 'opted_out') outcome = 'already_in_state'
      else outcome = 'applied'
    } else {
      if (!row || row.status !== 'opted_out') outcome = 'no_active_opt_out'
      else if (last != null && at <= last) outcome = 'stale'
      else outcome = 'applied'
    }

    const [event] = await trx('whatsapp_opt_out_events')
      .insert({
        agencyId,
        customerPhoneE164: phone,
        kind: command,
        source: 'inbound_command',
        outcome,
        eventAt,
        messageExternalId,
      })
      .returning('id')
    const eventId = Number((event as { id: number | string }).id)

    if (outcome === 'applied') {
      if (!row) {
        await trx('whatsapp_opt_outs').insert({
          agencyId,
          customerPhoneE164: phone,
          status: 'opted_out',
          firstOptedOutAt: eventAt,
          optedOutAt: eventAt,
          lastEventAt: eventAt,
          lastEventId: eventId,
        })
      } else if (command === 'opt_out') {
        await trx('whatsapp_opt_outs')
          .where({ id: row.id })
          .update({ status: 'opted_out', optedOutAt: eventAt, lastEventAt: eventAt, lastEventId: eventId, updatedAt: trx.fn.now() })
      } else {
        await trx('whatsapp_opt_outs')
          .where({ id: row.id })
          .update({ status: 'opted_in', optedInAt: eventAt, lastEventAt: eventAt, lastEventId: eventId, updatedAt: trx.fn.now() })
      }
    }

    // The customer is opted out from here on: end their pending automated
    // replies in the same transaction, under a SAVEPOINT, so a failure rolls
    // back only the cancellation and never the opt-out. The send gate stays
    // the final authority either way.
    let skippedPendingJobs = 0 as number | null
    if (command === 'opt_out' && (outcome === 'applied' || outcome === 'already_in_state')) {
      try {
        skippedPendingJobs = await trx.transaction((sp) => deps.skipPendingJobs(sp, agencyId, phone))
      } catch (err) {
        skippedPendingJobs = null
        console.error('[optOut] pending-job cancellation failed; the send gate still blocks', {
          agencyId,
          reason: (err as Error)?.message,
        })
      }
    }
    return { outcome, eventId, skippedPendingJobs }
  })
}

/** Audit one manual template exception, inside the gate's transaction, before the send. */
export async function insertManualOptOutException(
  trx: Knex.Transaction,
  input: {
    agencyId: number
    customerPhoneE164: string
    actorUserId: number
    templateId: number
    templateName: string
    templateCategory: string
    reason: string
  },
): Promise<number> {
  const [row] = await trx('whatsapp_opt_out_events')
    .insert({
      agencyId: input.agencyId,
      customerPhoneE164: input.customerPhoneE164,
      kind: 'manual_exception',
      source: 'manual_template',
      outcome: 'granted',
      eventAt: trx.fn.now(),
      actorUserId: input.actorUserId,
      templateId: input.templateId,
      templateName: input.templateName,
      templateCategory: input.templateCategory,
      reason: input.reason,
    })
    .returning('id')
  return Number((row as { id: number | string }).id)
}

export async function setManualExceptionProviderMessageId(
  trx: Knex.Transaction,
  eventId: number,
  providerMessageId: string,
): Promise<void> {
  await trx('whatsapp_opt_out_events').where({ id: eventId, kind: 'manual_exception' }).update({ providerMessageId })
}
