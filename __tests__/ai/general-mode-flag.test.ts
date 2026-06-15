import { afterEach, describe, expect, it } from 'vitest'
import { isGeneralModeEnabled } from '@/lib/ai/flags'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'

// `isGeneralModeEnabled` gates the no-lead General Mode rollout. The default
// (no `GENERAL_MODE_AGENCY_IDS`) MUST be off so production behaviour is
// unchanged until an agency is explicitly opted in. getAiEnv() caches, so each
// case sets env then resets the cache before reading the flag.

function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  _resetAiEnvCacheForTests()
}

afterEach(() => {
  withEnv({ AI_ENABLED: undefined, GENERAL_MODE_AGENCY_IDS: undefined })
})

describe('isGeneralModeEnabled', () => {
  it('is OFF by default (AI on, no allowlist) — production behaviour preserved', () => {
    withEnv({ AI_ENABLED: '1', GENERAL_MODE_AGENCY_IDS: undefined })
    expect(isGeneralModeEnabled(5)).toBe(false)
  })

  it('is OFF when AI is disabled, even if the agency is allowlisted', () => {
    withEnv({ AI_ENABLED: undefined, GENERAL_MODE_AGENCY_IDS: '5' })
    expect(isGeneralModeEnabled(5)).toBe(false)
  })

  it('is ON for an allowlisted agency and OFF for others', () => {
    withEnv({ AI_ENABLED: '1', GENERAL_MODE_AGENCY_IDS: '5,9' })
    expect(isGeneralModeEnabled(5)).toBe(true)
    expect(isGeneralModeEnabled(9)).toBe(true)
    expect(isGeneralModeEnabled(7)).toBe(false)
  })

  it('honours the "all" wildcard', () => {
    withEnv({ AI_ENABLED: '1', GENERAL_MODE_AGENCY_IDS: 'all' })
    expect(isGeneralModeEnabled(123)).toBe(true)
  })

  it('is OFF for a missing agency id', () => {
    withEnv({ AI_ENABLED: '1', GENERAL_MODE_AGENCY_IDS: 'all' })
    expect(isGeneralModeEnabled(null)).toBe(false)
    expect(isGeneralModeEnabled(undefined)).toBe(false)
  })
})
