import { describe, it, expect } from 'vitest'
import { nextInterval } from '@/modules/inbox/client/pollSchedule'
import {
  LEAD_POLL_FOCUSED_MS,
  LEAD_POLL_HIDDEN_MS,
  LEAD_POLL_MAX_IDLE,
  nextInterval as nextIntervalFromLib,
} from '@/lib/polling/pollSchedule'

const focusedMs = [3500, 5000] as const
const hiddenMs = [30000, 60000] as const
const base = { focusedMs, hiddenMs, maxIdle: 4 }

describe('nextInterval (inbox bands)', () => {
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

describe('nextInterval (lead bands — Wave A11)', () => {
  const leadBase = {
    focusedMs: LEAD_POLL_FOCUSED_MS,
    hiddenMs: LEAD_POLL_HIDDEN_MS,
    maxIdle: LEAD_POLL_MAX_IDLE,
  }

  it('locks focused min at 15000 (never inbox 3.5s)', () => {
    expect(LEAD_POLL_FOCUSED_MS[0]).toBe(15_000)
    expect(nextIntervalFromLib({ ...leadBase, hidden: false, idleStreak: 0 })).toBe(15_000)
  })

  it('focused idle ramps to 45000', () => {
    expect(nextIntervalFromLib({ ...leadBase, hidden: false, idleStreak: LEAD_POLL_MAX_IDLE })).toBe(45_000)
  })

  it('hidden min is at least 60000', () => {
    expect(LEAD_POLL_HIDDEN_MS[0]).toBe(60_000)
    expect(nextIntervalFromLib({ ...leadBase, hidden: true, idleStreak: 0 })).toBe(60_000)
  })

  it('hidden idle ramps to 120000', () => {
    expect(nextIntervalFromLib({ ...leadBase, hidden: true, idleStreak: LEAD_POLL_MAX_IDLE })).toBe(120_000)
  })

  it('re-export path matches lib/polling', () => {
    expect(nextInterval({ ...leadBase, hidden: false, idleStreak: 0 })).toBe(
      nextIntervalFromLib({ ...leadBase, hidden: false, idleStreak: 0 }),
    )
  })
})
