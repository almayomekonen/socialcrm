type Counted = { total: number }

export type AttentionCounts = {
  overdue: Counted
  dueToday: Counted
  stale: Counted
  waiting?: Counted
}

/**
 * True only when nothing needs attention — all lists are empty.
 * Keys on `total` (the true COUNT(*) reported by the readers), so a capped
 * sample never affects the verdict. Used to collapse the crm.attention answer
 * into a single calm line instead of three empty sections.
 */
export function attentionAllClear(p: AttentionCounts): boolean {
  return p.overdue.total === 0 && p.dueToday.total === 0 && p.stale.total === 0 && (p.waiting?.total ?? 0) === 0
}
