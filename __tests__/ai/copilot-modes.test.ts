import { describe, it, expect } from 'vitest'
import {
  COPILOT_MODES,
  DEFAULT_COPILOT_MODE_ID,
  getCopilotMode,
  isCopilotModeId,
  resolveCopilotModeRole,
} from '@/lib/ai/copilotModes'

// ─── Mode catalog pins ──────────────────────────────────────────────────────
// These tests pin the user-facing mode → internal ModelRole contract. The
// composer's `ModeButton` reads `label`/`icon`/`description`; the router uses
// `role` (via `resolveCopilotModeRole`) to pick a provider chain. A drift on
// any of these is a routing or editorial bug, not a refactor.

describe('COPILOT_MODES catalog — pinned mappings', () => {
  it('exposes exactly the 3 audited modes in canonical order', () => {
    expect(COPILOT_MODES.map((m) => m.id)).toEqual(['fast', 'smart', 'advanced'])
  })

  it('default mode is "smart" — matches today\'s `lead.askQuestion` behaviour', () => {
    expect(DEFAULT_COPILOT_MODE_ID).toBe('smart')
  })

  it.each([
    ['fast', 'volume'],
    ['smart', 'primary'],
    ['advanced', 'heavy'],
  ] as const)('mode "%s" routes to ModelRole "%s"', (modeId, expectedRole) => {
    expect(getCopilotMode(modeId).role).toBe(expectedRole)
    expect(resolveCopilotModeRole(modeId)).toBe(expectedRole)
  })

  it('every mode has a Hebrew label and a non-empty description', () => {
    for (const mode of COPILOT_MODES) {
      expect(mode.label).toMatch(/[֐-׿]/)
      expect(mode.description.length).toBeGreaterThan(0)
    }
  })

  it('only "advanced" carries a tier requirement today', () => {
    expect(getCopilotMode('fast').requiredTier).toBeUndefined()
    expect(getCopilotMode('smart').requiredTier).toBeUndefined()
    expect(getCopilotMode('advanced').requiredTier).toBe('pro')
  })
})

describe('isCopilotModeId — input validation guard', () => {
  it.each([['fast'], ['smart'], ['advanced']])('accepts "%s"', (value) => {
    expect(isCopilotModeId(value)).toBe(true)
  })

  it.each([['volume'], ['primary'], ['heavy'], [''], [null], [undefined], [0], [{}], [['fast']]] as const)(
    'rejects %s (not a valid mode id)',
    (value) => {
      expect(isCopilotModeId(value as unknown)).toBe(false)
    },
  )
})

describe('resolveCopilotModeRole — fallback to default', () => {
  it('returns the default mode\'s role on unknown / null / undefined input', () => {
    const expected = getCopilotMode(DEFAULT_COPILOT_MODE_ID).role
    expect(resolveCopilotModeRole(undefined)).toBe(expected)
    expect(resolveCopilotModeRole(null)).toBe(expected)
    expect(resolveCopilotModeRole('not-a-mode')).toBe(expected)
    expect(resolveCopilotModeRole(42)).toBe(expected)
  })

  it('honours every valid mode id', () => {
    for (const mode of COPILOT_MODES) {
      expect(resolveCopilotModeRole(mode.id)).toBe(mode.role)
    }
  })
})
