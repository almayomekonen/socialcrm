/**
 * Pure interval calculator for adaptive, visibility-aware poll loops.
 * Focused tabs poll at the fast end of their band and ease toward the slow end
 * as idle streak grows; hidden tabs use a separate (slower) band.
 * Pure — no React, unit-testable.
 */
export type PollBand = readonly [minMs: number, maxMs: number]

export interface NextIntervalOpts {
  hidden: boolean
  /** Consecutive polls that returned no change; reset to 0 on any change/activity. */
  idleStreak: number
  /** Focused band, e.g. inbox [3500, 5000] or leads [15000, 45000]. */
  focusedMs: PollBand
  /** Hidden band, e.g. inbox [30000, 60000] or leads [60000, 120000]. */
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

/** Lead desk polling bands (Wave A11). Never reuse inbox 3.5s defaults. */
export const LEAD_POLL_FOCUSED_MS = [15_000, 45_000] as const satisfies PollBand
export const LEAD_POLL_HIDDEN_MS = [60_000, 120_000] as const satisfies PollBand
export const LEAD_POLL_MAX_IDLE = 4
