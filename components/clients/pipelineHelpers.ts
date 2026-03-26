export function formatReturnTime(snoozeUntil: Date | string): string {
  const ms = new Date(snoozeUntil).getTime() - Date.now()
  if (ms <= 0) return 'חוזר עכשיו'
  const mins = Math.floor(ms / 60_000)
  const hours = Math.floor(ms / 3_600_000)
  if (mins < 60) return `חוזר בעוד ${mins} דקות`
  if (hours < 24) return `חוזר בעוד ${hours} שעות`
  return 'חוזר מחר'
}

export function getLastMeaningfulEvent(lead: { lastActivityAt?: string | Date | null; createdAt?: string | Date }): Date {
  if (lead.lastActivityAt) return new Date(lead.lastActivityAt)
  return new Date(lead.createdAt)
}

export function getNextAction(lead: {
  rank: number | string
  lastActivityAt?: string | Date | null
  createdAt?: string | Date
}): string {
  const rank = Number(lead.rank)
  let base = ''
  if (rank === 1) base = 'צור קשר ראשון'
  else if (rank === 2 || rank === 3) base = 'התקשר'
  else if (rank === 4) base = 'התקדם לסגירה'
  if (!base) return ''
  const diffHours = (Date.now() - getLastMeaningfulEvent(lead).getTime()) / (1000 * 60 * 60)
  return diffHours > 48 ? `דחוף: ${base}` : base
}

export function getReturnContext(lead: { snoozeUntil?: string | Date | null; lastOutcomeType?: string | null }): string | null {
  if (!lead.snoozeUntil) return null
  const snoozeMs = new Date(lead.snoozeUntil).getTime()
  const now = Date.now()
  if (snoozeMs > now) return null
  if (now - snoozeMs > 6 * 60 * 60 * 1000) return null

  const returnedMs = now - snoozeMs
  const timeStr =
    returnedMs < 3_600_000 ? `לפני ${Math.floor(returnedMs / 60_000)} דקות` : `לפני ${Math.floor(returnedMs / 3_600_000)} שעות`

  if (lead.lastOutcomeType === 'no-answer') return `לא ענה — חזר ${timeStr}`
  if (lead.lastOutcomeType === 'snooze') return `נדחה — חזר ${timeStr}`
  return null
}
