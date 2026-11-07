/**
 * businessInstantMs on clock-change days (JavaScript Temporal's "compatible" rule):
 *   - a time that does not exist moves forward by the gap (02:30 → 03:30);
 *   - a time that occurs twice is the first occurrence.
 * Every other time is unchanged from the previous convergence algorithm.
 *
 * Israel, from the Intl database: spring-forward 02:00 → 03:00 on 2026-03-27 and
 * 2027-03-26; fall-back 02:00 → 01:00 on 2026-10-25 and 2027-10-31.
 */
import { describe, expect, it } from 'vitest'
import { businessInstantMs } from '@/lib/today/time'

const TZ = 'Asia/Jerusalem'
const iso = (ms: number) => new Date(ms).toISOString()

/** Wall clock in `tz` as "YYYY-MM-DD HH:MM", independent of the code under test. */
function wall(ms: number, tz = TZ): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** The previous implementation, kept here only as the reference for unchanged times. */
function previousAlgorithm(dateStr: string, timeStr: string, tz = TZ): number {
  const target = Date.parse(`${dateStr}T${timeStr}:00Z`)
  if (Number.isNaN(target)) return Number.NaN
  const wallMs = (ms: number) => Date.parse(`${wall(ms, tz).replace(' ', 'T')}:00Z`)
  let guess = target
  for (let i = 0; i < 3; i++) guess += target - wallMs(guess)
  return guess
}

describe('spring forward: a time that does not exist moves forward by the gap', () => {
  it.each([
    ['2026-03-27', '01:59', '2026-03-26T23:59:00.000Z', '2026-03-27 01:59'],
    ['2026-03-27', '02:00', '2026-03-27T00:00:00.000Z', '2026-03-27 03:00'],
    ['2026-03-27', '02:30', '2026-03-27T00:30:00.000Z', '2026-03-27 03:30'],
    ['2026-03-27', '02:59', '2026-03-27T00:59:00.000Z', '2026-03-27 03:59'],
    ['2026-03-27', '03:00', '2026-03-27T00:00:00.000Z', '2026-03-27 03:00'],
    ['2027-03-26', '02:00', '2027-03-26T00:00:00.000Z', '2027-03-26 03:00'],
    ['2027-03-26', '02:30', '2027-03-26T00:30:00.000Z', '2027-03-26 03:30'],
    ['2027-03-26', '02:59', '2027-03-26T00:59:00.000Z', '2027-03-26 03:59'],
    ['2027-03-26', '03:00', '2027-03-26T00:00:00.000Z', '2027-03-26 03:00'],
  ])('%s %s → %s (local %s)', (date, time, utc, local) => {
    const ms = businessInstantMs(date, time)
    expect(iso(ms)).toBe(utc)
    expect(wall(ms)).toBe(local)
  })

  it('the previously reported failure: 02:30 is no longer an hour early (01:30)', () => {
    expect(wall(businessInstantMs('2026-03-27', '02:30'))).not.toBe('2026-03-27 01:30')
  })
})

describe('fall back: a time that occurs twice is the first occurrence', () => {
  it.each([
    ['2026-10-25', '00:59', '2026-10-24T21:59:00.000Z'],
    ['2026-10-25', '01:00', '2026-10-24T22:00:00.000Z'],
    ['2026-10-25', '01:30', '2026-10-24T22:30:00.000Z'],
    ['2026-10-25', '01:59', '2026-10-24T22:59:00.000Z'],
    ['2026-10-25', '02:00', '2026-10-25T00:00:00.000Z'],
    ['2027-10-31', '01:00', '2027-10-30T22:00:00.000Z'],
    ['2027-10-31', '01:30', '2027-10-30T22:30:00.000Z'],
    ['2027-10-31', '01:59', '2027-10-30T22:59:00.000Z'],
    ['2027-10-31', '02:00', '2027-10-31T00:00:00.000Z'],
  ])('%s %s → %s', (date, time, utc) => {
    expect(iso(businessInstantMs(date, time))).toBe(utc)
  })

  it('the first occurrence is one hour before the second', () => {
    const first = businessInstantMs('2026-10-25', '01:30')
    expect(wall(first)).toBe('2026-10-25 01:30')
    expect(wall(first + 3_600_000)).toBe('2026-10-25 01:30') // the second 01:30 exists, and is not chosen
  })
})

describe('every other time is unchanged', () => {
  const inGapOrOverlap = (date: string, time: string) =>
    (['2026-03-27', '2027-03-26'].includes(date) && time.startsWith('02:')) ||
    (['2026-10-25', '2027-10-31'].includes(date) && time.startsWith('01:'))

  function* times(stepMin: number) {
    for (let m = 0; m < 24 * 60; m += stepMin) yield `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  it('matches the previous algorithm across 2026-2027 (every 3 hours) and round-trips', () => {
    for (let d = Date.UTC(2026, 0, 1); d < Date.UTC(2028, 0, 1); d += 86_400_000) {
      const date = new Date(d).toISOString().slice(0, 10)
      for (const time of times(180)) {
        const ms = businessInstantMs(date, time)
        expect(ms, `${date} ${time}`).toBe(previousAlgorithm(date, time))
        expect(wall(ms), `${date} ${time}`).toBe(`${date} ${time}`)
      }
    }
  })

  it('matches the previous algorithm on the clock-change days themselves, outside the changed hour', () => {
    for (const date of ['2026-03-27', '2026-10-25', '2027-03-26', '2027-10-31', '2026-03-26', '2026-10-24']) {
      for (const time of times(15)) {
        if (inGapOrOverlap(date, time)) continue
        expect(businessInstantMs(date, time), `${date} ${time}`).toBe(previousAlgorithm(date, time))
      }
    }
  })
})

describe('general', () => {
  it('returns NaN for input it cannot parse', () => {
    expect(businessInstantMs('2026-13-40', '10:00')).toBeNaN()
    expect(businessInstantMs('2026-11-08', 'ten')).toBeNaN()
  })

  it('the same rule holds in another zone (America/New_York, 2026-03-08 and 2026-11-01)', () => {
    expect(wall(businessInstantMs('2026-03-08', '02:30', 'America/New_York'), 'America/New_York')).toBe('2026-03-08 03:30')
    expect(iso(businessInstantMs('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z') // EDT, the first
  })
})
