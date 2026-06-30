import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({})) // the 'server-only' marker isn't resolvable in the test runner

import { isReasonedGeneralEnabledForUser } from '@/lib/copilot/featureFlag'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'

// Proves the disabled-by-default contract: with no opt-in env, the reasoned path
// is OFF, so resolveAnswer skips it entirely and the existing path is unchanged.
describe('reasoned general flag — OFF by default', () => {
  beforeEach(() => _resetAiEnvCacheForTests())

  it('returns false when nothing is opted in', () => {
    expect(isReasonedGeneralEnabledForUser({ agencyId: 1 })).toBe(false)
  })

  it('returns false for a null user', () => {
    expect(isReasonedGeneralEnabledForUser(null)).toBe(false)
  })
})
