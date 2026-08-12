import { db } from '@/config/db'

/**
 * Follow-up notification candidates — Task 5.
 *
 * Reads CURRENT persisted `clients.nextFollowUpAt` (timestamptz). Writers never
 * enqueue; the cron tick asks "what is due / overdue right now?" and notifyEvent
 * absorbs duplicates via eventKey.
 *
 * Uses `clients_agency_next_followup_idx` (agencyId, nextFollowUpAt) WHERE
 * nextFollowUpAt IS NOT NULL.
 */

export type FollowupCandidateRow = {
  id: number
  agencyId: number
  firstName: string | null
  lastName: string | null
  nextFollowUpAt: Date
}

/** Bounds cost per cron tick; backlog drains across minutes. */
export const FOLLOWUP_TICK_LIMIT = 200

/**
 * Due: instant has arrived, still within the current BUSINESS_TZ day.
 *   dayStart <= nextFollowUpAt <= now
 * (Trigger is the persisted instant — not midnight. dayStart only keeps due
 * distinct from overdue.)
 */
export function findFollowupsDueQuery(now: Date, dayStart: Date, limit: number) {
  return db.raw(
    `
    SELECT c.id, c."agencyId", c."firstName", c."lastName", c."nextFollowUpAt"
      FROM clients c
     WHERE c.lead = true
       AND c.status IS DISTINCT FROM 'closed'
       AND c.status IS DISTINCT FROM 'lost'
       AND c."nextFollowUpAt" IS NOT NULL
       AND c."nextFollowUpAt" <= ?
       AND c."nextFollowUpAt" >= ?
     ORDER BY c."nextFollowUpAt" ASC, c.id ASC
     LIMIT ?
  `,
    [now, dayStart, limit],
  )
}

/**
 * Overdue: persisted follow-up is before the current BUSINESS_TZ day start.
 *   nextFollowUpAt < dayStart
 */
export function findFollowupsOverdueQuery(dayStart: Date, limit: number) {
  return db.raw(
    `
    SELECT c.id, c."agencyId", c."firstName", c."lastName", c."nextFollowUpAt"
      FROM clients c
     WHERE c.lead = true
       AND c.status IS DISTINCT FROM 'closed'
       AND c.status IS DISTINCT FROM 'lost'
       AND c."nextFollowUpAt" IS NOT NULL
       AND c."nextFollowUpAt" < ?
     ORDER BY c."nextFollowUpAt" ASC, c.id ASC
     LIMIT ?
  `,
    [dayStart, limit],
  )
}

function mapRows(res: { rows?: Record<string, unknown>[] }): FollowupCandidateRow[] {
  return (res.rows ?? []).map((r) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    firstName: (r.firstName as string | null) ?? null,
    lastName: (r.lastName as string | null) ?? null,
    nextFollowUpAt: r.nextFollowUpAt instanceof Date ? r.nextFollowUpAt : new Date(String(r.nextFollowUpAt)),
  }))
}

export async function findFollowupsDue(
  now: Date,
  dayStart: Date,
  limit = FOLLOWUP_TICK_LIMIT,
): Promise<FollowupCandidateRow[]> {
  const res = await findFollowupsDueQuery(now, dayStart, limit)
  return mapRows(res)
}

export async function findFollowupsOverdue(
  dayStart: Date,
  limit = FOLLOWUP_TICK_LIMIT,
): Promise<FollowupCandidateRow[]> {
  const res = await findFollowupsOverdueQuery(dayStart, limit)
  return mapRows(res)
}
