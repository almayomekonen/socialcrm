/**
 * Follow-Up Engine V1 — Stage 4: dashboard ranking.
 *
 * Classifies dashboard leads into the three cards (needs-handling / today / new).
 * Pure function (no DB, no SQL) so the ranking rules stay testable and the shared
 * getLeadsTable query — which also powers the main /leads table — is untouched.
 *
 * Rules:
 *  - An explicit follow-up date ALWAYS wins over SLA-derived urgency.
 *  - A DUE follow-up (<= now) → "needs handling", ranked ABOVE SLA-cold leads.
 *  - A FUTURE follow-up suppresses SLA urgency entirely (quiet until its day).
 *  - No follow-up set (NULL) → unchanged SLA behavior, exactly as before.
 */

export type DashboardLead = {
  id: number
  name: string
  phone: string | null
  status: string
  state: 'cold' | 'updated' | null
  slaRemainingHours: number | null
  nextAction: string | null
  leadSource: string | null
  nextFollowUpAt: string | Date | null
  followUpNote?: string | null
}

function followUpMs(lead: DashboardLead): number | null {
  if (!lead.nextFollowUpAt) return null
  const t = new Date(lead.nextFollowUpAt).getTime()
  return Number.isNaN(t) ? null : t // bad data → treat as no follow-up (fall back to SLA)
}

export function bucketDashboardLeads<T extends DashboardLead>(
  rows: T[],
  nowMs: number = Date.now(),
): { overdue: T[]; today: T[]; fresh: T[] } {
  const dueFollowUp: T[] = []
  const overdueSla: T[] = []
  const today: T[] = []
  const fresh: T[] = []

  for (const r of rows) {
    if (r.status === 'closed' || r.status === 'lost') continue

    const fu = followUpMs(r)
    if (fu !== null) {
      // Explicit follow-up overrides SLA: due → needs handling; future → suppressed.
      if (fu <= nowMs) dueFollowUp.push(r)
      continue
    }

    // No follow-up set → original SLA behavior, unchanged.
    if (r.state === 'cold') overdueSla.push(r)
    else if (r.slaRemainingHours != null && r.slaRemainingHours <= 24) today.push(r)
    else if (r.status === 'new') fresh.push(r)
  }

  // Overdue follow-ups rank above SLA-cold leads; most-overdue (earliest) first.
  dueFollowUp.sort((a, b) => (followUpMs(a) ?? 0) - (followUpMs(b) ?? 0))

  return {
    overdue: [...dueFollowUp, ...overdueSla].slice(0, 5),
    today: today.slice(0, 5),
    fresh: fresh.slice(0, 5),
  }
}
