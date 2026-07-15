/**
 * Unit tests for the Runtime-aware qualification decision layer (pure, no DB).
 * Proves the ownership split: config owns required fields + priority + thresholds;
 * the Runtime supplies confidence/uncertainty (never enumerates missing, never
 * ranks); the engine only orchestrates CONTINUE vs HANDOFF and points at the gap.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  selectNextGap,
  decideRuntimeQualification,
  decideConversationPolicy,
  isRuntimeQualificationEnabled,
} from '@/lib/inbox/autoresponse/runtimeQualification'
import { detectHumanRequest } from '@/lib/inbox/autoresponse/qualify'
import type { RuntimeCognition } from '@/lib/copilot/general/runtimeCognition'
import type { Qualification } from '@/lib/inbox/autoresponse/qualification'

function cog(maxCredence: number | null, open: string[] = []): RuntimeCognition {
  return {
    leadId: '1',
    grounded: maxCredence !== null,
    confidence: null,
    groundedness: null,
    uncertaintyKinds: [],
    provenanceSources: [],
    anyStale: false,
    openQuestions: open,
    recommendation: { outcome: 'none', rationale: null },
    reasoningChain: maxCredence === null ? [] : [{ key: 'x', leaning: 'holds', credence: maxCredence }],
    memory: { episodicCount: 0, baseRateCount: 0 },
  }
}

const REQ = ['need', 'budget', 'urgency'] // config priority order

describe('Runtime qualification — gap selection (config priority, never repeat)', () => {
  it('selects the first MISSING required field in configured order', () => {
    expect(selectNextGap({ need: 'CRM' }, REQ)).toBe('budget') // need known → next is budget
    expect(selectNextGap({}, REQ)).toBe('need') // nothing known → first required
    expect(selectNextGap({ need: 'x', budget: 'y', urgency: 'z' }, REQ)).toBeNull() // all known
  })

  it('never selects an already-known field (never repeats)', () => {
    expect(selectNextGap({ need: 'CRM', budget: '500' }, REQ)).toBe('urgency')
  })
})

describe('Runtime qualification — CONTINUE vs HANDOFF (config + Runtime, no reasoning)', () => {
  const base = { required: REQ, turnCount: 0, maxTurns: 6, confidenceThreshold: 0.8 }

  it('CONTINUE on the highest-priority missing field when confidence is low', () => {
    const d = decideRuntimeQualification({ ...base, qualification: { need: 'CRM' }, cognition: cog(0.68) })
    expect(d.decision).toBe('CONTINUE')
    expect(d.gap).toBe('budget')
    expect(d.missing).toEqual(['budget', 'urgency'])
    expect(d.confidence).toBeCloseTo(0.68)
  })

  it('HANDOFF when all required fields are collected (config + state)', () => {
    const d = decideRuntimeQualification({ ...base, qualification: { need: 'x', budget: 'y', urgency: 'z' }, cognition: cog(0.5) })
    expect(d.decision).toBe('HANDOFF')
    expect(d.gap).toBeNull()
    expect(d.reason).toMatch(/collected/i)
  })

  it('HANDOFF when Runtime confidence ≥ configured threshold (even with fields missing)', () => {
    const d = decideRuntimeQualification({ ...base, qualification: { need: 'CRM' }, cognition: cog(0.9) })
    expect(d.decision).toBe('HANDOFF')
    expect(d.reason).toMatch(/confidence/i)
  })

  it('HANDOFF when max AI turns reached', () => {
    const d = decideRuntimeQualification({ ...base, turnCount: 6, qualification: { need: 'CRM' }, cognition: cog(0.5) })
    expect(d.decision).toBe('HANDOFF')
    expect(d.reason).toMatch(/turns/i)
  })

  it('CONTINUE with no cognition (ungrounded) still asks the config gap — config drives it', () => {
    const d = decideRuntimeQualification({ ...base, qualification: {}, cognition: null })
    expect(d.decision).toBe('CONTINUE')
    expect(d.gap).toBe('need')
    expect(d.confidence).toBeNull()
  })

  it('surfaces Runtime open questions to inform framing (not to select)', () => {
    const d = decideRuntimeQualification({ ...base, qualification: { need: 'CRM' } as Qualification, cognition: cog(0.6, ['urgency']) })
    expect(d.reason).toContain('urgency')
    expect(d.gap).toBe('budget') // selection still by config priority, not by the open question
  })
})

describe('Runtime qualification — per-agency canary flag', () => {
  const KEYS = ['RUNTIME_QUALIFICATION_AGENCY_IDS', 'RUNTIME_QUALIFICATION_KILL'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults OFF, honours allowlist and kill', () => {
    delete process.env.RUNTIME_QUALIFICATION_AGENCY_IDS
    delete process.env.RUNTIME_QUALIFICATION_KILL
    expect(isRuntimeQualificationEnabled(103)).toBe(false)
    process.env.RUNTIME_QUALIFICATION_AGENCY_IDS = '103'
    expect(isRuntimeQualificationEnabled(103)).toBe(true)
    expect(isRuntimeQualificationEnabled(104)).toBe(false)
    process.env.RUNTIME_QUALIFICATION_KILL = '1'
    expect(isRuntimeQualificationEnabled(103)).toBe(false)
  })
})

const OPT = ['location', 'callback'] // optional pool, distinct from REQ

describe('Conversation policy — single ASK/HANDOFF (threshold-free, Runtime-driven)', () => {
  const base = { required: REQ, optional: OPT, turnCount: 0, maxTurns: 6 }

  it('ASK while a required field is still missing — business floor, even with no cognition', () => {
    const d = decideConversationPolicy({ ...base, qualification: { need: 'CRM' }, cognition: null })
    expect(d.decision).toBe('ASK')
    expect(d.gap).toBe('budget') // first missing required by config order
  })

  it('required complete + Runtime settled (no open questions) → HANDOFF', () => {
    const d = decideConversationPolicy({ ...base, qualification: { need: 'x', budget: 'y', urgency: 'z' }, cognition: cog(0.9, []) })
    expect(d.decision).toBe('HANDOFF')
    expect(d.gap).toBeNull()
  })

  it('required complete + Runtime still has an open question → ASK one optional field', () => {
    const d = decideConversationPolicy({ ...base, qualification: { need: 'x', budget: 'y', urgency: 'z' }, cognition: cog(0.5, ['need']) })
    expect(d.decision).toBe('ASK')
    expect(d.gap).toBe('location') // first optional by config order
  })

  it('required complete + open question but no optional field left → HANDOFF', () => {
    const d = decideConversationPolicy({ ...base, optional: [], qualification: { need: 'x', budget: 'y', urgency: 'z' }, cognition: cog(0.5, ['need']) })
    expect(d.decision).toBe('HANDOFF')
  })

  it('required complete + no cognition (no runtime signal) → HANDOFF', () => {
    const d = decideConversationPolicy({ ...base, qualification: { need: 'x', budget: 'y', urgency: 'z' }, cognition: null })
    expect(d.decision).toBe('HANDOFF')
  })

  it('max AI turns reached → HANDOFF even with a required field missing', () => {
    const d = decideConversationPolicy({ ...base, turnCount: 6, qualification: { need: 'CRM' }, cognition: null })
    expect(d.decision).toBe('HANDOFF')
    expect(d.reason).toMatch(/turns/i)
  })

  it('no confidence threshold: only open-question EXISTENCE matters, never the credence magnitude', () => {
    const q = { need: 'x', budget: 'y', urgency: 'z' }
    // open question present → ASK regardless of how high/low the credence is
    expect(decideConversationPolicy({ ...base, qualification: q, cognition: cog(0.01, ['need']) }).decision).toBe('ASK')
    expect(decideConversationPolicy({ ...base, qualification: q, cognition: cog(0.99, ['need']) }).decision).toBe('ASK')
    // no open question → HANDOFF regardless of credence
    expect(decideConversationPolicy({ ...base, qualification: q, cognition: cog(0.01, []) }).decision).toBe('HANDOFF')
    expect(decideConversationPolicy({ ...base, qualification: q, cognition: cog(0.99, []) }).decision).toBe('HANDOFF')
  })
})

describe('Hard rule — explicit human request (bypasses reasoning)', () => {
  it('detects human/call/meeting requests but NOT buying intent', () => {
    expect(detectHumanRequest('אני רוצה לדבר עם נציג')).toBe(true)
    expect(detectHumanRequest('בוא נקבע פגישה')).toBe(true)
    expect(detectHumanRequest('call me please')).toBe(true)
    expect(detectHumanRequest('אני צריך להתחיל השבוע')).toBe(false) // buying intent, not a human request
    expect(detectHumanRequest('כמה זה עולה')).toBe(false)
  })
})
