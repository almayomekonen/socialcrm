import { describe, it, expect } from 'vitest'
import { nextInterval } from '@/modules/inbox/client/pollSchedule'

const focusedMs = [3500, 5000] as const
const hiddenMs = [30000, 60000] as const
const base = { focusedMs, hiddenMs, maxIdle: 4 }

describe('nextInterval', () => {
  it('focused + idle 0 → fast end (3500)', () => {
    expect(nextInterval({ ...base, hidden: false, idleStreak: 0 })).toBe(3500)
  })
  it('focused + idle ≥ maxIdle → slow end (5000)', () => {
    expect(nextInterval({ ...base, hidden: false, idleStreak: 4 })).toBe(5000)
    expect(nextInterval({ ...base, hidden: false, idleStreak: 99 })).toBe(5000)
  })
  it('focused + half idle → midpoint', () => {
    expect(nextInterval({ ...base, hidden: false, idleStreak: 2 })).toBe(4250)
  })
  it('hidden + idle 0 → 30000 (no nagging when activity just happened)', () => {
    expect(nextInterval({ ...base, hidden: true, idleStreak: 0 })).toBe(30000)
  })
  it('hidden + idle ≥ maxIdle → 60000', () => {
    expect(nextInterval({ ...base, hidden: true, idleStreak: 4 })).toBe(60000)
  })
  it('negative idleStreak clamps to fast end', () => {
    expect(nextInterval({ ...base, hidden: false, idleStreak: -3 })).toBe(3500)
  })
})
