import type { Knex } from 'knex'
import { emitAutomationEvent } from './emit'

/**
 * THE ONE PLACE a lead's status change reaches the automation engine.
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
 * NOT a wrapper around the engine. `emitAutomationEvent` is still the only door
 * into the queue, still applies every gate in its own order, and still never
 * throws. This only fixes the CALLER shape.
 */
export async function emitLeadStatusChanged(input: {
  agencyId: number
  leadId: number
  /** The status the lead moved INTO. Snapshot-evaluated at emission. */
  newStatus: string
  /**
   * The business moment — the same value written to `statusChangedAt`. The
   * occurrence key anchors on it (`status_changed:{newStatus}:{ms}`), so passing
   * the row's own timestamp is what makes a retry idempotent rather than
   * producing a second job.
   */
  occurredAt: Date
  /** Joins the caller's transaction, so a rolled-back write enqueues nothing. */
  trx?: Knex.Transaction
}): Promise<void> {
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
}
