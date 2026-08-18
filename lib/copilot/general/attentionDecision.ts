import type { BriefingLeadList } from '@/db/briefing'

/**
 * Deterministic Decision Layer for crm.attention. Pure ranking + wording — no AI,
 * no confidence. It picks ONE top priority from the same evidence the sections
 * render below, so every headline is auditable. The data stays the source of
 * truth; this is only a recommendation on top.
 *
 * Strict ranking: waiting inbound → overdue tasks → follow-ups due today → stale leads.
 * Order is operational (ball in your court, then broken commitments), not a score.
 */
export type AttentionPayload = {
  overdue: BriefingLeadList
  dueToday: BriefingLeadList
  stale: BriefingLeadList
  waiting?: BriefingLeadList
}

export type AttentionDecision = {
  leadName: string
  reason: string
  secondary: { count: number; area: string } | null
}

const AREA = {
  waiting: 'שיחות ממתינות',
  overdue: 'משימות באיחור',
  dueToday: 'מעקבים להיום',
  stale: 'לידים שמתקררים',
} as const

const dayStr = (n: number): string => (n === 1 ? 'יום אחד' : `${n} ימים`)

function emptyList(): BriefingLeadList {
  return { total: 0, sample: [] }
}

export function buildAttentionDecision(p: AttentionPayload): AttentionDecision | null {
  const tiers = [
    { key: 'waiting' as const, list: p.waiting ?? emptyList() },
    { key: 'overdue' as const, list: p.overdue },
    { key: 'dueToday' as const, list: p.dueToday },
    { key: 'stale' as const, list: p.stale },
  ]

  const winnerIdx = tiers.findIndex((t) => t.list.total > 0 && t.list.sample.length > 0)
  if (winnerIdx === -1) return null // nothing needs attention → no headline (all-clear handled elsewhere)

  const winner = tiers[winnerIdx]
  const top = winner.list.sample[0]
  const leadName = top.name?.trim() || 'ליד ללא שם'
  const age = top.ageDays

  let reason: string
  if (winner.key === 'waiting') {
    reason = 'שלח הודעה ועדיין ממתין למענה'
  } else if (winner.key === 'overdue') {
    reason = age != null ? `המשימה באיחור ${dayStr(age)}` : 'יש משימה באיחור'
  } else if (winner.key === 'dueToday') {
    reason = 'המעקב מתוזמן להיום'
  } else {
    reason = age != null ? `לא היית בקשר כבר ${dayStr(age)}` : 'עדיין לא יצרת איתו קשר'
  }

  // Secondary = the next non-empty tier below the winner (a different area).
  const next = tiers.slice(winnerIdx + 1).find((t) => t.list.total > 0)
  const secondary = next ? { count: next.list.total, area: AREA[next.key] } : null

  return { leadName, reason, secondary }
}
