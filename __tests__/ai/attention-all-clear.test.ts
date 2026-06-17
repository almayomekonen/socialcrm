import { describe, it, expect } from 'vitest'
import { attentionAllClear } from '@/lib/copilot/general/attentionState'

const counts = (overdue: number, dueToday: number, stale: number) => ({
  overdue: { total: overdue },
  dueToday: { total: dueToday },
  stale: { total: stale },
})

describe('attentionAllClear — collapse to one calm line only when nothing needs attention', () => {
  it('all three empty → true (single calm line)', () => {
    expect(attentionAllClear(counts(0, 0, 0))).toBe(true)
  })

  it('any one section with data → false (preserve existing three-section layout)', () => {
    expect(attentionAllClear(counts(1, 0, 0))).toBe(false)
    expect(attentionAllClear(counts(0, 1, 0))).toBe(false)
    expect(attentionAllClear(counts(0, 0, 1))).toBe(false)
  })

  it('all sections with data → false', () => {
    expect(attentionAllClear(counts(3, 2, 5))).toBe(false)
  })

  it('keys on true total, not sample size — a capped list with total>0 is not clear', () => {
    expect(attentionAllClear(counts(50, 0, 0))).toBe(false)
  })
})
