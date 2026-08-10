import { db } from '@/config/db'

/**
 * Has this connection ever actually received anything?
 *
 * The single most useful fact while a webhook is being set up, and the one the
 * product could not answer before C3: a mistyped URL and a working URL look
 * identical until something arrives.
 *
 * Written by the generic webhook route on every VERIFIED delivery — verified,
 * not accepted, because a signed payload we chose not to act on still proves
 * the wiring works, and that is what the customer is trying to confirm.
 */

export type DeliveryFacts = {
  lastEventAt: string | null
  eventCount: number
  /** When a delivery was last REFUSED. Null = never. */
  lastRejectedAt: string | null
  /** Refusals since the last verified delivery. A delivery resets it to zero. */
  consecutiveRejections: number
  /** The TECHNICAL reason, never rendered — the UI maps it to customer copy. */
  lastRejectionReason: string | null
}

/**
 * A verified delivery. Unchanged in what it always did, plus the reset that
 * makes `consecutiveRejections` mean "in a row".
 *
 * The reset is not bookkeeping: it is the false-positive guard. The webhook
 * endpoint is reachable by anyone who knows the URL, so a stranger posting
 * garbage could otherwise drive a perfectly healthy connection into an alarm.
 * Because every good delivery zeroes the streak, a connection that is still
 * receiving valid traffic can never accumulate one — whatever noise arrives
 * alongside it.
 */
export async function recordDelivery(connectionRowId: number): Promise<void> {
  await db('automation_connections')
    .where({ id: connectionRowId })
    .update({
      lastEventAt: db.fn.now(),
      eventCount: db.raw('COALESCE("eventCount", 0) + 1'),
      consecutiveRejections: 0,
      lastRejectionReason: null,
    })
}

/**
 * A delivery that arrived and was refused.
 *
 * The counter is incremented in SQL rather than read-modify-written for exactly
 * the reason `eventCount` is: two deliveries racing must both count. The
 * SEMANTICS are `nextConsecutiveFailures` from lib/polling/syncFailure.ts —
 * `failed ? prev + 1 : 0` — with the failure branch here and the reset branch in
 * `recordDelivery` above. `__tests__/automations/intakeRejection.test.ts` pins
 * the two against that helper so the shapes cannot drift.
 *
 * `lastEventAt` is deliberately NOT touched: nothing was delivered, and moving
 * it would recreate the very lie this whole change exists to remove.
 */
export async function recordRejection(connectionRowId: number, reason: string): Promise<void> {
  await db('automation_connections')
    .where({ id: connectionRowId })
    .update({
      lastRejectedAt: db.fn.now(),
      lastRejectionReason: reason,
      consecutiveRejections: db.raw('COALESCE("consecutiveRejections", 0) + 1'),
    })
}

export function deliveryFactsQuery(agencyId: number) {
  return db('automation_connections')
    .select('id', 'integrationKey', 'lastEventAt', 'eventCount', 'lastRejectedAt', 'consecutiveRejections', 'lastRejectionReason')
    .where({ agencyId })
}

/**
 * Keyed by the same `<integrationKey>:<id>` string the Connection layer uses,
 * so the caller never has to know how a connector stores its rows. A connector
 * with its own table simply has no entry, and the UI says "not reported" rather
 * than "never received".
 */
export async function deliveryFacts(agencyId: number): Promise<Record<string, DeliveryFacts>> {
  const rows = (await deliveryFactsQuery(agencyId)) as {
    id: number
    integrationKey: string
    lastEventAt: Date | string | null
    eventCount: number | string | null
    lastRejectedAt: Date | string | null
    consecutiveRejections: number | string | null
    lastRejectionReason: string | null
  }[]
  const out: Record<string, DeliveryFacts> = {}
  for (const row of rows) {
    out[`${row.integrationKey}:${row.id}`] = {
      lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
      eventCount: Number(row.eventCount ?? 0),
      lastRejectedAt: row.lastRejectedAt ? new Date(row.lastRejectedAt).toISOString() : null,
      consecutiveRejections: Number(row.consecutiveRejections ?? 0),
      lastRejectionReason: row.lastRejectionReason ?? null,
    }
  }
  return out
}
