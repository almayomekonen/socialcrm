import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_DAYS,
  MAX_CUSTOM_HOURS,
  isValidTiming,
  resolveSendAt,
  withinQuietHours,
  type Timing,
} from '@/lib/automations/timing'

const T0 = new Date('2026-08-02T12:00:00Z') // 15:00 Asia/Jerusalem (IDT, UTC+3)

describe('resolveSendAt — delay presets only (ADR-007: no anchors)', () => {
  it('immediate is the trigger moment', () => {
    expect(resolveSendAt(T0, { kind: 'preset', preset: 'immediate' }).getTime()).toBe(T0.getTime())
  })

  it('one_hour and one_day are exact offsets', () => {
    expect(resolveSendAt(T0, { kind: 'preset', preset: 'one_hour' }).getTime()).toBe(T0.getTime() + 3_600_000)
    expect(resolveSendAt(T0, { kind: 'preset', preset: 'one_day' }).getTime()).toBe(T0.getTime() + 86_400_000)
  })

  it('custom hours and days are exact offsets', () => {
    expect(resolveSendAt(T0, { kind: 'custom', value: 3, unit: 'hours' }).getTime()).toBe(T0.getTime() + 3 * 3_600_000)
    expect(resolveSendAt(T0, { kind: 'custom', value: 3, unit: 'days' }).getTime()).toBe(T0.getTime() + 3 * 86_400_000)
  })
})

describe('isValidTiming — V1 bounds', () => {
  it('accepts all presets', () => {
    for (const preset of ['immediate', 'one_hour', 'one_day'] as const) {
      expect(isValidTiming({ kind: 'preset', preset })).toBe(true)
    }
  })

  it('accepts whole custom values inside the bounds', () => {
    expect(isValidTiming({ kind: 'custom', value: 1, unit: 'hours' })).toBe(true)
    expect(isValidTiming({ kind: 'custom', value: MAX_CUSTOM_HOURS, unit: 'hours' })).toBe(true)
    expect(isValidTiming({ kind: 'custom', value: MAX_CUSTOM_DAYS, unit: 'days' })).toBe(true)
  })

  it('rejects zero, negatives, fractions, and out-of-bound values', () => {
    const bad: Timing[] = [
      { kind: 'custom', value: 0, unit: 'hours' },
      { kind: 'custom', value: -1, unit: 'days' },
      { kind: 'custom', value: 1.5, unit: 'hours' },
      { kind: 'custom', value: MAX_CUSTOM_HOURS + 1, unit: 'hours' },
      { kind: 'custom', value: MAX_CUSTOM_DAYS + 1, unit: 'days' },
    ]
    for (const t of bad) expect(isValidTiming(t)).toBe(false)
  })
})

describe('withinQuietHours — BUSINESS_TZ wall clock (IRE-cloned semantics)', () => {
  it('inactive when unset or partially set', () => {
    expect(withinQuietHours(null, T0)).toBe(false)
    expect(withinQuietHours(undefined, T0)).toBe(false)
  })

  it('same-day window: 15:00 Jerusalem is inside 14..18 and outside 16..18', () => {
    expect(withinQuietHours({ startHour: 14, endHour: 18 }, T0)).toBe(true)
    expect(withinQuietHours({ startHour: 16, endHour: 18 }, T0)).toBe(false)
  })

  it('midnight-crossing window (22..7): 23:00 Jerusalem is inside, 15:00 is outside', () => {
    const elevenPmJerusalem = new Date('2026-08-02T20:00:00Z') // 23:00 IDT
    expect(withinQuietHours({ startHour: 22, endHour: 7 }, elevenPmJerusalem)).toBe(true)
    expect(withinQuietHours({ startHour: 22, endHour: 7 }, T0)).toBe(false)
  })

  it('end hour is exclusive; start hour is inclusive', () => {
    const threePm = T0 // 15:00 IDT
    expect(withinQuietHours({ startHour: 15, endHour: 16 }, threePm)).toBe(true)
    expect(withinQuietHours({ startHour: 13, endHour: 15 }, threePm)).toBe(false)
  })

  it('honors an explicit tz override (UTC: 12:00 is inside 12..13)', () => {
    expect(withinQuietHours({ startHour: 12, endHour: 13, tz: 'UTC' }, T0)).toBe(true)
  })
})
