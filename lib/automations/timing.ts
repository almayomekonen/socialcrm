import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * V1 timing is DELAY-BASED ONLY (ADR-007: event-date anchors are excluded —
 * no anchor field, no before-anchor presets, no anchor-passed law). Delays are
 * pure offsets from the trigger moment, so they are timezone-independent; the
 * quiet-hours window below is the one place wall-clock time matters, and it is
 * always evaluated in BUSINESS_TZ (never the device timezone).
 */

export type TimingPreset = 'immediate' | 'one_hour' | 'one_day'

export type Timing =
  | { kind: 'preset'; preset: TimingPreset }
  | { kind: 'custom'; value: number; unit: 'hours' | 'days' }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// V1 bounds for custom delays: whole units, at most 30 days out. A bound this
// far exceeds every launch recipe; it exists so a typo cannot schedule a send
// into next year.
export const MAX_CUSTOM_HOURS = 720
export const MAX_CUSTOM_DAYS = 30

export function isValidTiming(t: Timing): boolean {
  if (t.kind === 'preset') return t.preset === 'immediate' || t.preset === 'one_hour' || t.preset === 'one_day'
  if (!Number.isInteger(t.value) || t.value < 1) return false
  return t.unit === 'hours' ? t.value <= MAX_CUSTOM_HOURS : t.value <= MAX_CUSTOM_DAYS
}

/** The moment a job becomes due. Caller validates with isValidTiming first. */
export function resolveSendAt(triggerAt: Date, t: Timing): Date {
  if (t.kind === 'preset') {
    if (t.preset === 'immediate') return new Date(triggerAt.getTime())
    return new Date(triggerAt.getTime() + (t.preset === 'one_hour' ? HOUR_MS : DAY_MS))
  }
  return new Date(triggerAt.getTime() + t.value * (t.unit === 'hours' ? HOUR_MS : DAY_MS))
}

// No-send window, cloned from the IRE worker's withinQuietHours: active only
// when both bounds are set; supports windows that cross midnight
// (startHour > endHour); hour resolved in BUSINESS_TZ by default.
export type QuietHoursConfig = { startHour: number; endHour: number; tz?: string }

export function withinQuietHours(qh: QuietHoursConfig | null | undefined, now: Date): boolean {
  if (qh?.startHour == null || qh?.endHour == null) return false
  const tz = qh.tz || BUSINESS_TZ
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now))
  return qh.startHour <= qh.endHour ? hour >= qh.startHour && hour < qh.endHour : hour >= qh.startHour || hour < qh.endHour
}
