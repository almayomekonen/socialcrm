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

export type DeliveryFacts = { lastEventAt: string | null; eventCount: number }

export async function recordDelivery(connectionRowId: number): Promise<void> {
  await db('automation_connections')
    .where({ id: connectionRowId })
    .update({ lastEventAt: db.fn.now(), eventCount: db.raw('COALESCE("eventCount", 0) + 1') })
}

export function deliveryFactsQuery(agencyId: number) {
  return db('automation_connections').select('id', 'integrationKey', 'lastEventAt', 'eventCount').where({ agencyId })
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
  }[]
  const out: Record<string, DeliveryFacts> = {}
  for (const row of rows) {
    out[`${row.integrationKey}:${row.id}`] = {
      lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
      eventCount: Number(row.eventCount ?? 0),
    }
  }
  return out
}
