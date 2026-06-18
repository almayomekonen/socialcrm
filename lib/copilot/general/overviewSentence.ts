/**
 * Deterministic one-line system overview for the `system.overview` intent.
 * Pure — composed from existing-reader counts; no model, no new data. Intentionally
 * a single sentence (NOT a re-render of the briefing cards, which already show above).
 */
export type OverviewCounts = {
  overdueTasks: number
  meetingsToday: number
  waitingConversations: number
  staleLeads: number
  newLeads: number
}

export function composeOverviewSentence(c: OverviewCounts): string {
  const parts: string[] = []
  if (c.overdueTasks > 0) parts.push(`${c.overdueTasks} משימות באיחור`)
  if (c.meetingsToday > 0) parts.push(`${c.meetingsToday} פגישות היום`)
  if (c.waitingConversations > 0) parts.push(`${c.waitingConversations} שיחות ממתינות`)
  if (c.staleLeads > 0) parts.push(`${c.staleLeads} לידים שלא בקשר`)
  if (c.newLeads > 0) parts.push(`${c.newLeads} לידים חדשים השבוע`)
  if (parts.length === 0) return 'הכול תחת שליטה — אין משימות דחופות כרגע.'
  return `היום: ${parts.join(' · ')}.`
}
