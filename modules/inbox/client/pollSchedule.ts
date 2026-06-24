/**
 * Pure interval calculator for the adaptive, visibility-aware inbox poll loop.
 * Focused tabs poll fast (and ease toward the slower end of the band as the
 * conversation stays idle); hidden tabs back off to a 30–60s band. Pure — no
 * React, unit-testable.
 */
export type PollBand = readonly [minMs: number, maxMs: number]

export interface NextIntervalOpts {
  hidden: boolean
  /** Consecutive polls that returned no change; reset to 0 on any change/activity. */
  idleStreak: number
  /** Focused band, e.g. [3500, 5000]. */
  focusedMs: PollBand
  /** Hidden band, e.g. [30000, 60000]. */
  hiddenMs: PollBand
  /** idleStreak at/above which the slow end of the band is reached. */
  maxIdle: number
}

export function nextInterval({ hidden, idleStreak, focusedMs, hiddenMs, maxIdle }: NextIntervalOpts): number {
  const [min, max] = hidden ? hiddenMs : focusedMs
  if (maxIdle <= 0) return min
  const t = Math.min(Math.max(idleStreak, 0), maxIdle) / maxIdle // 0..1
  return Math.round(min + (max - min) * t)
}
