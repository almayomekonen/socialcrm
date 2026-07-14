/**
 * Unit tests for Integration-1 shadow ingestion (pure, no DB).
 * Injects the belief writer, so the Qualification→Belief mapping, the per-agency
 * flag gate, and the guarded (never-throws) contract are all tested without a
 * database. The runtime ingress seam (M3 interpret) runs for real (it is pure).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  shadowIngestQualification,
  isShadowIngestEnabled,
  type ShadowIngestDeps,
} from '@/lib/ai/integration/shadowIngest'

const ENABLED: ShadowIngestDeps['isEnabled'] = () => true

function mockApply() {
  const calls: Array<{ subjectId: string; belief: Record<string, unknown> }> = []
  const fn = (async (_scope: unknown, subjectId: string, belief: Record<string, unknown>) => {
    calls.push({ subjectId, belief })
    return {} as never
  }) as unknown as ShadowIngestDeps['applyBelief']
  return { fn, calls }
}

const input = (extracted: Record<string, string>) => ({ agencyId: 7, leadId: 42, conversationId: 100, extracted })

describe('Integration-1 shadow ingest — flag gate', () => {
  it('is a pure no-op when the flag is off (no writes)', async () => {
    const apply = mockApply()
    const r = await shadowIngestQualification(input({ budget: '50k' }), { isEnabled: () => false, applyBelief: apply.fn })
    expect(r.skipped).toBe(true)
    expect(r.ingested).toBe(0)
    expect(apply.calls).toHaveLength(0)
  })
})

describe('Integration-1 shadow ingest — Qualification→Belief mapping', () => {
  it('writes one belief per non-empty field, keyed and provenance-traced to the conversation', async () => {
    const apply = mockApply()
    const r = await shadowIngestQualification(input({ budget: '50k', timeline: 'Q3', note: '  ' }), {
      isEnabled: ENABLED,
      applyBelief: apply.fn,
    })
    expect(r.skipped).toBe(false)
    expect(r.ingested).toBe(2) // whitespace-only 'note' skipped
    expect(apply.calls.map((c) => c.belief.key).sort()).toEqual(['qualification.budget', 'qualification.timeline'])
    const budget = apply.calls.find((c) => c.belief.key === 'qualification.budget')!
    expect(budget.subjectId).toBe('42')
    expect(budget.belief.content).toEqual({ value: '50k' })
    const prov = budget.belief.provenance as { traceRefs: Array<{ type: string; id: string }>; inferentialDistance: string }
    expect(prov.traceRefs).toEqual([{ type: 'conversation', id: '100' }]) // walks back to the conversation
    expect(prov.inferentialDistance).toBe('medium') // inferred from a message, never presented as observed
  })

  it('ingests nothing from an empty extraction', async () => {
    const apply = mockApply()
    const r = await shadowIngestQualification(input({}), { isEnabled: ENABLED, applyBelief: apply.fn })
    expect(r.ingested).toBe(0)
    expect(apply.calls).toHaveLength(0)
  })
})

describe('Integration-1 shadow ingest — never affects the caller', () => {
  it('swallows writer failures and never throws', async () => {
    const throwingApply = (async () => {
      throw new Error('db down')
    }) as unknown as ShadowIngestDeps['applyBelief']
    const r = await shadowIngestQualification(input({ budget: '50k', timeline: 'Q3' }), {
      isEnabled: ENABLED,
      applyBelief: throwingApply,
    })
    expect(r.errored).toBe(2)
    expect(r.ingested).toBe(0) // failure never masquerades as success
  })
})

describe('Integration-1 shadow ingest — the per-agency canary flag', () => {
  const KEYS = ['SHADOW_INGEST_AGENCY_IDS', 'SHADOW_INGEST_KILL'] as const
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults OFF with no allowlist', () => {
    delete process.env.SHADOW_INGEST_AGENCY_IDS
    delete process.env.SHADOW_INGEST_KILL
    expect(isShadowIngestEnabled(7)).toBe(false)
  })

  it('enables only allowlisted agencies (canary)', () => {
    delete process.env.SHADOW_INGEST_KILL
    process.env.SHADOW_INGEST_AGENCY_IDS = '7, 9'
    expect(isShadowIngestEnabled(7)).toBe(true)
    expect(isShadowIngestEnabled(8)).toBe(false)
  })

  it("supports 'all' and a global kill backstop", () => {
    process.env.SHADOW_INGEST_AGENCY_IDS = 'all'
    delete process.env.SHADOW_INGEST_KILL
    expect(isShadowIngestEnabled(123)).toBe(true)
    process.env.SHADOW_INGEST_KILL = '1'
    expect(isShadowIngestEnabled(123)).toBe(false) // kill overrides the allowlist
  })
})
