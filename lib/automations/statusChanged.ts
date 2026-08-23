import type { Knex } from 'knex'
import { notifyEvent } from '@/lib/notifications/emit'
import { emitAutomationEvent } from './emit'
import {
  buildTransitionInput,
  recordStatusTransition,
  type TransitionSource,
} from '@/db/leadStatusTransitions'

/**
 * THE ONE PLACE a lead's status change fans out to the engines that care.
 *
 * Three business actions move a lead's status, and each used to build this
 * event object itself: `updateLead` (the status control), `logLeadOutcome` (a
 * call outcome) and `insertSale` (Close Deal). Three copies of one shape is
 * three chances to drift — and the drift already happened: Close Deal moved the
 * record to Customers by flipping `lead = false` and emitted nothing, so an
 * automation listening for "status changed → closed" never ran for the business
 * action that actually closes deals.
 *
 * So the shape lives here, once. A new status-writing surface calls this and is
 * automatically visible to every current and future automation; it cannot
 * accidentally invent a different event.
 *
 * NOT a wrapper around either engine. `emitAutomationEvent` and `notifyEvent`
 * are each still the only door into their own queue, each still applies its own
 * gates in its own order, and neither throws. This only fixes the CALLER shape.
 *
 * The two engines stay separate domains with separate queues and separate kill
 * switches (notification spec §3); they merely share this one description of
 * what happened. That is the whole reason this file exists: the alternative is
 * three surfaces each describing a status change twice over, which is six
 * chances to drift instead of one.
 */
export async function emitLeadStatusChanged(input: {
  agencyId: number
  leadId: number
  /** The status the lead moved INTO. Snapshot-evaluated at emission. */
  newStatus: string
  /**
   * WHO changed it. Notifications use this to avoid telling a rep about their
   * own action (notification spec §6.3) — and since a rep usually changes the
   * status of their own lead, omitting it would turn this event into pure noise.
   * Null/absent means a system actor and nobody is dropped.
   */
  actorUserId?: number | null
  /** The lead's display name, for notification copy. Absent ⇒ name-free copy. */
  leadName?: string | null
  /**
   * The business moment — the same value written to `statusChangedAt`. The
   * occurrence key anchors on it (`status_changed:{newStatus}:{ms}`), so passing
   * the row's own timestamp is what makes a retry idempotent rather than
   * producing a second job.
   */
  occurredAt: Date
  /**
   * The status the lead moved OUT of, for the durable transition log. Every
   * call site already holds it except `updateLead`, which reads it immediately
   * before its write. `undefined` records a null origin rather than dropping the
   * row — see db/leadStatusTransitions.ts for the documented race window on the
   * two surfaces that write without a transaction or row lock.
   */
  previousStatus?: string | null
  /** Which surface performed the change. Defaults to 'manual'. */
  source?: TransitionSource
  /** Joins the caller's transaction, so a rolled-back write enqueues nothing. */
  trx?: Knex.Transaction
}): Promise<void> {
  /**
   * Durable pipeline history — written FIRST, and inside the caller's
   * transaction when there is one, so a rolled-back status write logs nothing.
   * First because the two engines below deliberately never throw: if history
   * came last, a future change to either could silently cost us the record.
   *
   * Guarded: history is valuable, but it must never break a user's status
   * change. A no-op status write (same value re-saved) records nothing.
   */
  try {
    const transition = buildTransitionInput({
      agencyId: input.agencyId,
      leadId: input.leadId,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      occurredAt: input.occurredAt,
      actorUserId: input.actorUserId ?? null,
      source: input.source ?? 'manual',
    })
    if (transition) await recordStatusTransition(transition, input.trx)
  } catch (err) {
    console.error('[statusChanged] transition log failed (swallowed)', {
      leadId: input.leadId,
      err: String(err),
    })
  }

  await emitAutomationEvent(
    {
      trigger: 'status_changed',
      // Every one of the three surfaces is a person acting in the product.
      origin: 'manual',
      agencyId: input.agencyId,
      leadId: input.leadId,
      occurredAt: input.occurredAt,
      newStatus: input.newStatus,
    },
    input.trx ? { trx: input.trx } : undefined,
  )

  // Notification engine: same moment, its own gates, its own queue. The status
  // is carried in the payload because it is part of this event's identity —
  // a lead can reach 'contacted' more than once, and the key anchors on the
  // status plus the business moment so a retry is idempotent.
  await notifyEvent(
    {
      type: 'lead.status_changed',
      agencyId: input.agencyId,
      entityType: 'lead',
      entityId: input.leadId,
      actorUserId: input.actorUserId ?? null,
      occurredAt: input.occurredAt,
      payload: { status: input.newStatus, leadName: input.leadName ?? null },
    },
    input.trx ? { trx: input.trx } : undefined,
  )
}
