/**
 * How long the hand-off has waited, in Hebrew words, for template variable {{1}}
 * ("...ממתין למענה שלך כבר {{1}}."). Whole hours, rounded down; a cron reminder
 * is only ever sent at 2 hours or later. Pure.
 */
export function waitingTimeHebrew(escalatedAt: Date, now: Date): string {
  const hours = Math.max(1, Math.floor((now.getTime() - escalatedAt.getTime()) / 3_600_000))
  if (hours === 1) return 'שעה'
  if (hours === 2) return 'שעתיים'
  return `${hours} שעות`
}

/**
 * The same, exact to the minute below one hour, for the one-off test send's
 * `immediate` mode, so a reminder after a few minutes never claims an hour.
 * From 60 minutes on it is `waitingTimeHebrew`. Pure.
 */
export function waitingTimeHebrewWithMinutes(escalatedAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - escalatedAt.getTime()) / 60_000))
  if (minutes >= 60) return waitingTimeHebrew(escalatedAt, now)
  return minutes === 1 ? 'דקה' : `${minutes} דקות`
}
