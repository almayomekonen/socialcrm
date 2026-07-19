import { describe, it, expect } from 'vitest'
import { pickNextEducational } from '@/lib/emailAutomations/journey'
import { EDUCATIONAL, EDUCATIONAL_KEYS } from '@/lib/emailAutomations/content/educational'

describe('educational progression (pickNextEducational)', () => {
  it('starts at the first item when nothing has been delivered', () => {
    expect(pickNextEducational(new Set())?.key).toBe(EDUCATIONAL[0].key)
  })

  it('advances to the next undelivered item, in order', () => {
    const delivered = new Set([EDUCATIONAL[0].key, EDUCATIONAL[1].key])
    expect(pickNextEducational(delivered)?.key).toBe(EDUCATIONAL[2].key)
  })

  it('never skips: a gap resumes at the EARLIEST undelivered item', () => {
    // Steps 1 and 3 delivered, step 2 missing → returns step 2, not step 4.
    const delivered = new Set([EDUCATIONAL[0].key, EDUCATIONAL[2].key])
    expect(pickNextEducational(delivered)?.key).toBe(EDUCATIONAL[1].key)
  })

  it('returns null once the whole sequence has been delivered', () => {
    expect(pickNextEducational(new Set(EDUCATIONAL_KEYS))).toBeNull()
  })

  it('the sequence has unique keys and a stable order', () => {
    expect(new Set(EDUCATIONAL_KEYS).size).toBe(EDUCATIONAL_KEYS.length)
    EDUCATIONAL.forEach((item, i) => expect(item.schedule).toEqual({ kind: 'step', step: i + 1 }))
  })
})
