/**
 * THE BENCHMARK IS TAMPER-EVIDENT.
 *
 * This is the half of the evaluation that runs in CI: no model, no database, no
 * credentials, no cost. It exists because the expensive half cannot run on every
 * commit, and a benchmark nobody checks is a benchmark that drifts — a reworded
 * question here, a swapped tenant there, and six months of recorded numbers
 * quietly stop meaning the same thing.
 *
 * THE DIGEST IS THE CONTRACT. Changing any question, tenant or case id moves it,
 * and this test fails with an instruction rather than a diff: bump
 * BENCHMARK_VERSION, record the change, and accept that historical totals are no
 * longer comparable. That is not an obstacle to improving the benchmark — it is
 * the price of being able to trust a comparison at all.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ACTIVE_CASES, BENCHMARK_VERSION, CASES, QUESTIONS, RETIRED, TENANTS } from './benchmark'
import { SCORING_VERSION, isTodayOnlyBroad, sawStructural, tally, latency, type CaseResult } from './scoring'
import { compareCounts } from './firewall'
import { verdictFor } from './report'

/**
 * Recovered verbatim from the pinned harness and cross-checked between two of
 * its revisions. If this digest changes, the recovery chain in README.md no
 * longer describes what is in this directory.
 */
const PINNED_DIGEST = 'd5d38d2f8044fb97ef8b77a4e5f023b6a018419fc875aa2eee3d599fef467687'

const digest = () =>
  createHash('sha256')
    .update(JSON.stringify({ q: QUESTIONS, t: TENANTS.map((t) => [t.label, t.agencyId, t.userId]), ids: CASES.map((c) => c.id) }))
    .digest('hex')

describe('the pinned 40 cannot change silently', () => {
  it('matches the recovered digest', () => {
    expect(digest()).toBe(PINNED_DIGEST)
  })

  it('is ten questions across four tenants', () => {
    expect(QUESTIONS).toHaveLength(10)
    expect(TENANTS).toHaveLength(4)
    expect(CASES).toHaveLength(40)
  })

  it('has stable, unique, correctly-shaped case ids', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(40)
    expect(CASES.map((c) => c.id).slice(0, 3)).toEqual(['A1', 'A2', 'A3'])
    expect(CASES[CASES.length - 1]!.id).toBe('D10')
    for (const c of CASES) expect(c.id).toBe(`${c.tenant.label}${c.questionIndex}`)
  })

  it('runs tenant-major, question-minor — the order the baseline was recorded in', () => {
    expect(CASES.slice(0, 10).every((c) => c.tenant.label === 'A')).toBe(true)
    expect(CASES.map((c) => c.question).slice(0, 10)).toEqual([...QUESTIONS])
  })

  it('carries no duplicate or empty question', () => {
    expect(new Set(QUESTIONS).size).toBe(10)
    for (const q of QUESTIONS) expect(q.trim().length).toBeGreaterThan(0)
  })

  it('retires cases explicitly, with a reason, and never by deletion', () => {
    for (const r of RETIRED) {
      expect(r.reason.trim().length).toBeGreaterThan(0)
      expect(CASES.some((c) => c.id === r.id)).toBe(true)
    }
    expect(ACTIVE_CASES).toHaveLength(40 - RETIRED.length)
  })

  it('stamps both versions, so a reader knows which kind of change happened', () => {
    expect(BENCHMARK_VERSION).toMatch(/^socialcrm-agent-40@\d+\.\d+\.\d+$/)
    expect(SCORING_VERSION).toMatch(/^scoring@\d+\.\d+\.\d+$/)
  })
})

// ── the scoring rules, which are ours and therefore need their own tests ─────

const caseResult = (over: Partial<CaseResult> = {}): CaseResult => ({
  id: 'A1', tenantLabel: 'A', questionIndex: 1, question: QUESTIONS[0]!,
  answered: true, stopReason: 'complete', investigationId: 'inv_1', steps: 2, evidenceCount: 5,
  toolsUsed: [], droppedClaims: 0, strippedRefs: 0, rejection: null, rejectionRuleId: null,
  businessState: 'URGENT', headline: 'ה', proposedAction: null, proposedBatch: null,
  timing: { totalMs: 1000, modelWaitMs: 900, toolWallMs: 100, toolCalls: 1, toolRoundTrips: 1 },
  harnessError: null, ...over,
})

describe('Today-only broad', () => {
  it('counts an answer built from the daily queue alone', () => {
    expect(isTodayOnlyBroad(caseResult({ toolsUsed: ['get_today_state'] }))).toBe(true)
  })

  it('does not count one that also reached a structural tool', () => {
    expect(isTodayOnlyBroad(caseResult({ toolsUsed: ['get_today_state', 'get_lead_health'] }))).toBe(false)
    expect(sawStructural(caseResult({ toolsUsed: ['get_today_state', 'get_lead_health'] }))).toBe(true)
  })

  it('does not count a case that used no tools — a different failure', () => {
    expect(isTodayOnlyBroad(caseResult({ toolsUsed: [] }))).toBe(false)
  })

  it('does not count a refused answer', () => {
    expect(isTodayOnlyBroad(caseResult({ answered: false, toolsUsed: ['get_today_state'] }))).toBe(false)
  })
})

describe('totals never flatter the run', () => {
  it('counts a dropped claim as a grounding failure even when the answer shipped', () => {
    const t = tally([caseResult({ droppedClaims: 1 })], 0)
    expect(t.answered).toBe(1)
    expect(t.groundingFailures).toBe(1)
  })

  it('separates a claim-gate refusal from a deadline and from a harness fault', () => {
    const t = tally(
      [
        caseResult({ answered: false, stopReason: 'invalid', rejection: 'unsupported-claim', rejectionRuleId: 'RULE_17' }),
        caseResult({ answered: false, stopReason: 'deadline' }),
        caseResult({ answered: false, stopReason: 'harness', harnessError: 'boom' }),
      ],
      0,
    )
    expect(t).toMatchObject({ unsupportedClaimFailures: 1, deadlineFailures: 1, harnessErrors: 1, answered: 0 })
  })

  it('counts an unrequested write as a spurious proposal', () => {
    expect(tally([caseResult({ proposedAction: { actionType: 'create_task' } })], 0).spuriousProposals).toBe(1)
    expect(tally([caseResult({ proposedBatch: { actionType: 'create_task' } })], 0).spuriousBatches).toBe(1)
  })

  it('reports latency over what ran, and zero for nothing', () => {
    expect(latency([]).p95).toBe(0)
    const l = latency([caseResult({ timing: { ...caseResult().timing, totalMs: 10 } }), caseResult({ timing: { ...caseResult().timing, totalMs: 30 } })])
    expect(l).toMatchObject({ avg: 20, max: 30 })
  })
})

describe('the verdict', () => {
  const clean = { totals: tally([caseResult()], 0), firewall: compareCounts(ZERO(), ZERO()), expectedCases: 1 }
  function ZERO() {
    return { tasks: 0, followUps: 0, meetings: 0, agentActions: 0, agentActionApprovals: 0 }
  }

  it('passes only a complete, clean run', () => {
    expect(verdictFor(clean as never)).toBe('PASS')
  })

  it('is INCOMPLETE when fewer cases ran than the benchmark defines — never rounded up', () => {
    expect(verdictFor({ ...clean, expectedCases: 40 } as never)).toBe('INCOMPLETE')
  })

  it('FAILS on a firewall breach whatever the answers looked like', () => {
    const breached = compareCounts(ZERO(), { ...ZERO(), tasks: 1 })
    expect(breached.ok).toBe(false)
    expect(verdictFor({ ...clean, firewall: breached } as never)).toBe('FAIL')
  })

  it('FAILS on a deadline failure', () => {
    expect(verdictFor({ ...clean, totals: tally([caseResult({ answered: false, stopReason: 'deadline' })], 0) } as never)).toBe('FAIL')
  })
})
