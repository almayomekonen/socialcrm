/**
 * How long the hand-off has waited, in Hebrew words, for template variable {{1}}
 * ("...ממתין למענה שלך כבר {{1}}."). Whole hours, rounded down; a reminder is
 * only ever sent at 2 hours or later. Pure.
 */
export function waitingTimeHebrew(escalatedAt: Date, now: Date): string {
  const hours = Math.max(1, Math.floor((now.getTime() - escalatedAt.getTime()) / 3_600_000))
  if (hours === 1) return 'שעה'
  if (hours === 2) return 'שעתיים'
  return `${hours} שעות`
}
