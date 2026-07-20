import { describe, expect, it } from 'vitest'
import { rolloutDecision, stableBucket, type RolloutConfig } from '@/lib/today/rollout'

const cfg = (o: Partial<RolloutConfig>): RolloutConfig => ({
  enabled: true,
  killSwitch: false,
  allowlist: [],
  percentage: 0,
  ...o,
})

describe('rolloutDecision — gradual rollout gate', () => {
  it('kill switch forces OFF regardless of everything else', () => {
    expect(rolloutDecision(cfg({ killSwitch: true, allowlist: 'all' }), 1)).toBe(false)
  })

  it('disabled → OFF', () => {
    expect(rolloutDecision(cfg({ enabled: false, allowlist: 'all' }), 1)).toBe(false)
  })

  it('non-numeric agency → OFF (never crash the page)', () => {
    expect(rolloutDecision(cfg({ allowlist: 'all' }), null)).toBe(false)
    expect(rolloutDecision(cfg({ allowlist: 'all' }), undefined)).toBe(false)
  })

  it("allowlist 'all' → ON; explicit allowlist targets one agency (canary)", () => {
    expect(rolloutDecision(cfg({ allowlist: 'all' }), 42)).toBe(true)
    expect(rolloutDecision(cfg({ allowlist: [122] }), 122)).toBe(true)
    expect(rolloutDecision(cfg({ allowlist: [122] }), 7)).toBe(false)
  })

  it('percentage boundaries: 0 → off, 100 → on', () => {
    expect(rolloutDecision(cfg({ percentage: 0 }), 7)).toBe(false)
    expect(rolloutDecision(cfg({ percentage: 100 }), 7)).toBe(true)
  })

  it('percentage cohort is deterministic (stable per agency)', () => {
    const a = rolloutDecision(cfg({ percentage: 50 }), 12345)
    const b = rolloutDecision(cfg({ percentage: 50 }), 12345)
    expect(a).toBe(b)
    expect(stableBucket(12345)).toBe(stableBucket(12345))
    expect(stableBucket(12345)).toBeGreaterThanOrEqual(0)
    expect(stableBucket(12345)).toBeLessThan(100)
  })

  it('cohort is monotonic: an agency ON at p% stays ON at higher p%', () => {
    const id = 999
    const bucket = stableBucket(id)
    for (let p = bucket + 1; p <= 100; p++) expect(rolloutDecision(cfg({ percentage: p }), id)).toBe(true)
  })

  it('allowlist wins over a 0% rollout (canary always on)', () => {
    expect(rolloutDecision(cfg({ allowlist: [5], percentage: 0 }), 5)).toBe(true)
  })
})
