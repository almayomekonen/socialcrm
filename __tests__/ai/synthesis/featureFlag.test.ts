import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({})) // the 'server-only' marker isn't resolvable in the test runner

import { isSynthesisEnabledForUser } from '@/lib/copilot/featureFlag'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'

const enableCopilot = (agencyIds: string) => {
  process.env.AI_COPILOT_ENABLED = 'true'
  process.env.AI_COPILOT_AGENCY_ALLOWLIST = agencyIds
}

// Proves the disabled-by-default contract: with no SYNTHESIS_AGENCY_IDS opt-in,
// the capability stays unreachable and product behavior is byte-identical.
describe('synthesis flag — OFF by default (C8)', () => {
  beforeEach(() => {
    delete process.env.AI_COPILOT_ENABLED
    delete process.env.AI_COPILOT_AGENCY_ALLOWLIST
    delete process.env.SYNTHESIS_AGENCY_IDS
    _resetAiEnvCacheForTests()
  })

  it('returns false with empty env (default OFF)', () => {
    expect(isSynthesisEnabledForUser({ agencyId: 122 })).toBe(false)
  })

  it('returns false for a null agency', () => {
    expect(isSynthesisEnabledForUser({ agencyId: null })).toBe(false)
  })

  it('returns false for an undefined agency', () => {
    expect(isSynthesisEnabledForUser({})).toBe(false)
  })

  it('returns false when the agency is not in the synthesis allowlist', () => {
    enableCopilot('122')
    process.env.SYNTHESIS_AGENCY_IDS = '999'
    _resetAiEnvCacheForTests()
    expect(isSynthesisEnabledForUser({ agencyId: 122 })).toBe(false)
  })

  it('returns true for an allowlisted agency (copilot on + in synthesis list)', () => {
    enableCopilot('122')
    process.env.SYNTHESIS_AGENCY_IDS = '122'
    _resetAiEnvCacheForTests()
    expect(isSynthesisEnabledForUser({ agencyId: 122 })).toBe(true)
  })

  it('is deterministic', () => {
    enableCopilot('122')
    process.env.SYNTHESIS_AGENCY_IDS = '122'
    _resetAiEnvCacheForTests()
    expect(isSynthesisEnabledForUser({ agencyId: 122 })).toBe(isSynthesisEnabledForUser({ agencyId: 122 }))
  })

  it('does not mutate the user object', () => {
    enableCopilot('122')
    process.env.SYNTHESIS_AGENCY_IDS = '122'
    _resetAiEnvCacheForTests()
    const user = { agencyId: 122 }
    const snap = { ...user }
    isSynthesisEnabledForUser(user)
    expect(user).toEqual(snap)
  })
})
