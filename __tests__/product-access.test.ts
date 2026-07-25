/**
 * lib/trial — hasActiveProductAccess: the canonical "does this agency have the
 * full product right now?" rule. Pure over the derived TrialStatus, no DB, no
 * mocks. Pins the exact mapping so no gate (lead quota today, more later) can
 * re-decide it differently. Complements trial-state.test.ts (which pins how the
 * status itself is derived).
 */
import { describe, it, expect } from 'vitest'
import { hasActiveProductAccess, type TrialStatus } from '@/lib/trial'

describe('hasActiveProductAccess', () => {
  it('PAID → full access', () => {
    expect(hasActiveProductAccess('PAID')).toBe(true)
  })

  it('TRIAL_ACTIVE → full access (trial is genuinely Pro)', () => {
    expect(hasActiveProductAccess('TRIAL_ACTIVE')).toBe(true)
  })

  it('LEGACY → full access (grandfathered)', () => {
    expect(hasActiveProductAccess('LEGACY')).toBe(true)
  })

  it('TRIAL_EXPIRED → no full access', () => {
    expect(hasActiveProductAccess('TRIAL_EXPIRED')).toBe(false)
  })

  it('NEVER_STARTED → no full access', () => {
    expect(hasActiveProductAccess('NEVER_STARTED')).toBe(false)
  })

  it('exactly PAID | TRIAL_ACTIVE | LEGACY grant access — no other status does', () => {
    const all: TrialStatus[] = ['PAID', 'LEGACY', 'NEVER_STARTED', 'TRIAL_ACTIVE', 'TRIAL_EXPIRED']
    const granting = all.filter(hasActiveProductAccess)
    expect(granting.sort()).toEqual(['LEGACY', 'PAID', 'TRIAL_ACTIVE'])
  })
})
