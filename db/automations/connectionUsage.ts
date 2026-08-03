import { db } from '@/config/db'

/**
 * What each Connection is actually being used FOR.
 *
 * The Connection layer knows a connection's identity and health; it does not
 * know how many automations depend on it or when one last did something. Those
 * are engine facts, so they are read here — once per page, grouped by
 * connection id, rather than per card.
 *
 * Agency-scoped in both queries. A connection id is opaque here: these are
 * GROUP BY reads over a text column, and nothing in this file knows what an
 * integration is.
 */

export type ConnectionUsage = { automations: number; lastActivityAt: string | null }

export function countAutomationsByConnectionQuery(agencyId: number) {
  return db('automation_definitions')
    .select('connectionId')
    .count<{ connectionId: string; c: string }[]>({ c: '*' })
    .where({ agencyId })
    .whereNotNull('connectionId')
    .whereNot('status', 'deleted')
    .groupBy('connectionId')
}

export function lastActivityByConnectionQuery(agencyId: number) {
  return db('automation_activity as a')
    .join('automation_definitions as d', 'd.id', 'a.automationId')
    .select('d.connectionId')
    .max<{ connectionId: string; last: string }[]>({ last: 'a.occurredAt' })
    .where('a.agencyId', agencyId)
    .whereNotNull('d.connectionId')
    .groupBy('d.connectionId')
}

/**
 * One map, keyed by connection id. A connection with no automations is absent
 * rather than zero-filled — the caller decides what "none yet" should say.
 */
export async function connectionUsage(agencyId: number): Promise<Record<string, ConnectionUsage>> {
  const [counts, activity] = await Promise.all([
    countAutomationsByConnectionQuery(agencyId),
    lastActivityByConnectionQuery(agencyId),
  ])

  const out: Record<string, ConnectionUsage> = {}
  for (const row of counts) {
    out[row.connectionId] = { automations: Number(row.c ?? 0), lastActivityAt: null }
  }
  for (const row of activity) {
    const entry = out[row.connectionId] ?? { automations: 0, lastActivityAt: null }
    entry.lastActivityAt = row.last ? new Date(row.last).toISOString() : null
    out[row.connectionId] = entry
  }
  return out
}
