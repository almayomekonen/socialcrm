/**
 * Phase 4.3 — the autonomous gate. Absence must block.
 *
 * The single most important property in this phase: a machine that has never
 * heard of this feature must never reach a model.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isInvestigationEnabled, isInvestigationKilled } from '@/lib/ai/integration/investigationFlags'

const KEYS = ['SIGNAL_INVESTIGATE_AGENCY_IDS', 'SIGNAL_INVESTIGATE_KILL'] as const
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('the autonomous gate is off unless explicitly turned on', () => {
  it('is off when unset — the production default', () => {
    expect(isInvestigationEnabled(122)).toBe(false)
    expect(isInvestigationKilled()).toBe(false)
  })

  for (const raw of ['', '   ', ',', 'nonsense']) {
    it(`is off for a malformed allowlist ${JSON.stringify(raw)}`, () => {
      process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = raw
      expect(isInvestigationEnabled(122)).toBe(false)
    })
  }

  it("refuses 'all' — a canary widened by a typo is not a canary", () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = 'all'
    expect(isInvestigationEnabled(122)).toBe(false)
  })

  it('enables only the listed agencies', () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = '122, 340'
    expect(isInvestigationEnabled(122)).toBe(true)
    expect(isInvestigationEnabled(340)).toBe(true)
    expect(isInvestigationEnabled(999)).toBe(false)
    expect(isInvestigationEnabled(null)).toBe(false)
    expect(isInvestigationEnabled(undefined)).toBe(false)
  })

  it('the kill switch beats the allowlist', () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = '122'
    for (const kill of ['1', 'true']) {
      process.env.SIGNAL_INVESTIGATE_KILL = kill
      expect(isInvestigationKilled()).toBe(true)
      expect(isInvestigationEnabled(122)).toBe(false)
    }
  })

  it('is read per call, so flipping it needs no redeploy', () => {
    expect(isInvestigationEnabled(122)).toBe(false)
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = '122'
    expect(isInvestigationEnabled(122)).toBe(true)
  })

  it('is a SECOND gate — it never implies the sweep allowlist', () => {
    // Code only: the header legitimately EXPLAINS the relationship to the sweep
    // allowlist, and matching prose would fail on a correct module.
    const code = require('node:fs')
      .readFileSync('lib/ai/integration/investigationFlags.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/SIGNAL_SWEEP_AGENCY_IDS/)
    expect(code).toMatch(/SIGNAL_INVESTIGATE_AGENCY_IDS/)
  })
})
