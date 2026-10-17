import { describe, expect, it } from 'vitest'
import { waitingTimeHebrew, waitingTimeHebrewWithMinutes } from '@/lib/ownerWhatsappReminders/waitingTime'

/** Immediate-mode wording: exact minutes under an hour, the cron's hours from 60 minutes. */
const at = new Date('2026-10-17T21:00:00Z')
const after = (ms: number) => new Date(at.getTime() + ms)

describe('waitingTimeHebrewWithMinutes', () => {
  it.each([
    [10_000, 'דקה'],
    [60_000, 'דקה'],
    [119_000, 'דקה'],
    [120_000, '2 דקות'],
    [5 * 60_000 + 30_000, '5 דקות'],
    [59 * 60_000, '59 דקות'],
  ])('%i ms → %s', (ms, text) => expect(waitingTimeHebrewWithMinutes(at, after(ms))).toBe(text))

  it('from 60 minutes on it is exactly the cron wording', () => {
    for (const ms of [60 * 60_000, 121 * 60_000, 5 * 3_600_000]) expect(waitingTimeHebrewWithMinutes(at, after(ms))).toBe(waitingTimeHebrew(at, after(ms)))
  })

  it('the cron wording is unchanged', () => {
    expect(waitingTimeHebrew(at, after(121 * 60_000))).toBe('שעתיים')
    expect(waitingTimeHebrew(at, after(5 * 60_000))).toBe('שעה')
  })
})
