import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * Timing comes in two shapes.
 *
 * DELAYS are pure offsets from the trigger moment, so they are
 * timezone-independent. They were V1's only shape (ADR-007 excluded anchors).
 *
 * BEFORE-ANCHOR timing lands the send a fixed offset BEFORE a datetime the
 * occurrence itself carries — "an hour before the meeting". ADR-007 deferred it
 * because there was no occurrence with a future datetime to anchor to; the
 * Meetings domain is that occurrence, so it arrives now.
 *
 * It introduces NO scheduling subsystem. `automation_jobs.notBefore` already
 * decides when a job becomes due; an anchor only changes the arithmetic that
 * produces that timestamp at emission. The queue, the claim, the lease and the
 * worker are untouched.
 *
 * The quiet-hours window below remains the one place wall-clock time matters,
 * and it is always evaluated in BUSINESS_TZ (never the device timezone).
 */

export type TimingPreset = 'immediate' | 'one_hour' | 'one_day'

export type TimingUnit = 'hours' | 'days'

export type Timing =
  | { kind: 'preset'; preset: TimingPreset }
  | { kind: 'custom'; value: number; unit: TimingUnit }
  /**
   * `anchorField` is a CATALOG FIELD KEY on the event, of type `datetime`.
   * Naming the field rather than carrying a value is what keeps this generic:
   * any future event with a future-dated field can be anchored to without a
   * change here.
   */
  | { kind: 'before_anchor'; anchorField: string; value: number; unit: TimingUnit }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// V1 bounds for custom delays: whole units, at most 30 days out. A bound this
// far exceeds every launch recipe; it exists so a typo cannot schedule a send
// into next year.
export const MAX_CUSTOM_HOURS = 720
export const MAX_CUSTOM_DAYS = 30

export function isValidTiming(t: Timing): boolean {
  if (!t || typeof t !== 'object') return false
  if (t.kind === 'preset') return t.preset === 'immediate' || t.preset === 'one_hour' || t.preset === 'one_day'
  if (t.kind === 'before_anchor' && !String(t.anchorField ?? '').trim()) return false
  if (t.kind !== 'custom' && t.kind !== 'before_anchor') return false
  if (!Number.isInteger(t.value) || t.value < 1) return false
  return t.unit === 'hours' ? t.value <= MAX_CUSTOM_HOURS : t.value <= MAX_CUSTOM_DAYS
}

/** Milliseconds an offset represents. */
export const offsetMs = (value: number, unit: TimingUnit): number => value * (unit === 'hours' ? HOUR_MS : DAY_MS)

/**
 * Why an anchored send produced no job. Both are ORDINARY outcomes, not errors:
 * a reminder that cannot be timed is simply not sent.
 */
export type AnchorMiss =
  /** The occurrence carries no usable value for the named field. */
  | 'anchor_missing'
  /** The computed moment is already past — the meeting is too soon to remind about. */
  | 'anchor_too_late'

export type SendAtResolution = { at: Date; miss: null } | { at: null; miss: AnchorMiss }

/**
 * The moment a job becomes due.
 *
 * Delay timings resolve from the trigger. A before-anchor timing resolves from
 * the anchor value the occurrence carried at emission, and can legitimately
 * fail to resolve — a meeting booked twenty minutes before it starts has no
 * "one hour before" moment left, and inventing one would send a reminder about
 * a meeting already under way.
 */
export function resolveSendAtDetailed(triggerAt: Date, t: Timing, anchors: Record<string, unknown> = {}): SendAtResolution {
  if (t.kind !== 'before_anchor') return { at: resolveSendAt(triggerAt, t), miss: null }

  const raw = anchors[t.anchorField]
  const anchorMs = raw instanceof Date ? raw.getTime() : typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : NaN
  if (!Number.isFinite(anchorMs)) return { at: null, miss: 'anchor_missing' }

  const at = new Date(anchorMs - offsetMs(t.value, t.unit))
  // Compared against the TRIGGER moment, not `Date.now()`, so emission is a
  // pure function of its inputs and the same event replays identically.
  if (at.getTime() <= triggerAt.getTime()) return { at: null, miss: 'anchor_too_late' }
  return { at, miss: null }
}

/**
 * The DELAY form. Caller validates with isValidTiming first.
 *
 * Retained with its original signature because it is the shape every existing
 * call site uses. A before-anchor timing cannot be resolved from the trigger
 * alone, so it falls back to the trigger moment here and callers that can
 * support anchors use `resolveSendAtDetailed` instead.
 */
export function resolveSendAt(triggerAt: Date, t: Timing): Date {
  if (t.kind === 'preset') {
    if (t.preset === 'immediate') return new Date(triggerAt.getTime())
    return new Date(triggerAt.getTime() + (t.preset === 'one_hour' ? HOUR_MS : DAY_MS))
  }
  if (t.kind === 'before_anchor') return new Date(triggerAt.getTime())
  return new Date(triggerAt.getTime() + offsetMs(t.value, t.unit))
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
