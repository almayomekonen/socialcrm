/**
 * A REFUSED investigation must record what actually ran.
 *
 * `ai_investigations` declares `steps NOT NULL DEFAULT 0`, `evidence DEFAULT '[]'`,
 * `droppedClaims DEFAULT 0`, `strippedRefs DEFAULT 0`. The refused branch of
 * `admitInvestigation` passed none of them, because `AgentResult`'s `ok: false`
 * arm carried none — `run.ts` assembled the telemetry for `onPersist` and then
 * dropped it from the return.
 *
 * So every refused investigation recorded `steps 0` / `evidence []` whatever it
 * did, and three production runs (inv_mtakjigp_tviv8y, inv_mtali8du_a534mo,
 * inv_mtam5jzv_t00wxx) were diagnosed against a number that was a DEFAULT, never a
 * measurement — $0.074255 spent chasing it.
 *
 * These tests prove the two refusals are now distinguishable, which is the whole
 * point: a run that used tools and a run that used none must not look identical.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { admitInvestigation, type AdmissionDeps } from '@/lib/ai/integration/investigationAdmission'
import type { SignalJob } from '@/db/ai/signalJobs'
import type { AgentScope } from '@/lib/agent/types'

const NOW = new Date('2026-08-26T21:36:00.000Z')
const SCOPE: AgentScope = {
  agencyId: 103,
  userId: 332,
  role: 'ADMIN' as AgentScope['role'],
  gotPermIds: [],
  plan: 'pro' as AgentScope['plan'],
  firstName: 'ע',
}

const job = (): SignalJob => ({
  id: 24882,
  agencyId: 103,
  observationKey: 'sla.open_loop:lead:1517:at:2026-08-23T20:32:12.814Z',
  expectation: 'sla.open_loop',
  subjectType: 'lead',
  subjectId: '1517',
  signal: { absence: { expectedBy: '2026-08-23T20:32:12.814Z' } } as SignalJob['signal'],
  status: 'leased',
  attempts: 1,
  maxAttempts: 3,
  detectedAt: NOW.toISOString(),
  createdAt: NOW.toISOString(),
})

const passingPre = () =>
  vi.fn(async () => ({
    proceed: true as const,
    scope: SCOPE,
    state: 'OPEN_LOOP_SLA' as const,
    operatorUserId: 332,
    value: {
      state: 'OPEN_LOOP_SLA',
      ownedByDeterministicNotification: false,
      expectedByMs: Date.parse('2026-08-23T20:32:12.814Z'),
      clock: { nowMs: NOW.getTime(), dayStart: NOW.getTime() - 3.6e6, dayEnd: NOW.getTime() + 3.6e6 },
      vigilance: 'dropped_commitment' as const,
    },
  }))

/**
 * Runs admission with a scripted AgentResult and returns what was persisted.
 *
 * The post-Agent seams are stubbed so BOTH the refused and the answered paths can
 * be driven: the answered path runs bridge -> decide -> isActive before it records,
 * and none of those is under test here.
 */
async function persisted(agentResult: Record<string, unknown>) {
  const recordInvestigation = vi.fn(async () => undefined as never)
  const deps: AdmissionDeps = {
    checkPreconditions: passingPre(),
    reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 4 } as never })),
    settle: vi.fn(async () => true),
    runAgent: vi.fn(async () => agentResult as never),
    recordInvestigation,
    bridge: vi.fn(() => ({}) as never),
    // stay_silent keeps the insight/delivery path out of this test entirely.
    decide: vi.fn(() => ({ emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' }, trace: [] }) as never),
    isReservationActive: vi.fn(async () => true),
    recordCoverage: vi.fn(async () => undefined as never),
  }
  await admitInvestigation(job(), { now: NOW, deps })
  const call = recordInvestigation.mock.calls[0] as unknown as [Record<string, unknown>] | undefined
  if (!call) throw new Error('recordInvestigation was never called')
  return call[0]
}

describe('A · tools executed, then the validator refused', () => {
  it('persists the REAL steps, evidence and counts', async () => {
    const rec = await persisted({
      ok: false,
      reason: 'no_evidence',
      investigationId: 'inv_tools_ran',
      costUsd: 0.0314,
      steps: 3,
      evidence: [
        { kind: 'lead', refId: '1517' },
        { kind: 'message', refId: '9001' },
      ],
      droppedClaims: 2,
      strippedRefs: 1,
      rejection: 'no-supportable-claim',
    })

    expect(rec.status).toBe('refused')
    expect(rec.steps).toBe(3)
    expect(rec.evidence).toHaveLength(2)
    expect(rec.droppedClaims).toBe(2)
    expect(rec.strippedRefs).toBe(1)
    // WHY it was refused survives, instead of a bare null.
    expect(rec.failureReason).toBe('no-supportable-claim')
  })
})

describe('B · no tool executed, then the validator refused', () => {
  it('persists a MEASURED zero and an empty evidence set', async () => {
    const rec = await persisted({
      ok: false,
      reason: 'no_evidence',
      investigationId: 'inv_no_tools',
      costUsd: 0.0131,
      steps: 0,
      evidence: [],
      droppedClaims: 0,
      strippedRefs: 0,
      rejection: 'no-supportable-claim',
    })

    expect(rec.status).toBe('refused')
    expect(rec.steps).toBe(0)
    expect(rec.evidence).toEqual([])
    expect(rec.failureReason).toBe('no-supportable-claim')
  })

  it('THE POINT: A and B produce different persisted records', async () => {
    const withTools = await persisted({
      ok: false,
      reason: 'no_evidence',
      investigationId: 'a',
      costUsd: 0.03,
      steps: 3,
      evidence: [{ kind: 'lead', refId: '1517' }],
      droppedClaims: 2,
      strippedRefs: 1,
      rejection: 'no-supportable-claim',
    })
    const without = await persisted({
      ok: false,
      reason: 'no_evidence',
      investigationId: 'b',
      costUsd: 0.03,
      steps: 0,
      evidence: [],
      droppedClaims: 0,
      strippedRefs: 0,
      rejection: 'no-supportable-claim',
    })
    expect(withTools.steps).not.toBe(without.steps)
    expect(withTools.evidence).not.toEqual(without.evidence)
  })

  /**
   * An absent measurement must stay absent, so the DB default applies. Recording a
   * missing value as a measured zero is the exact confusion this change removes.
   */
  it('a result with NO telemetry omits the fields entirely', async () => {
    const rec = await persisted({ ok: false, reason: 'gate_denied', message: 'over-quota', costUsd: 0 })
    expect('steps' in rec).toBe(false)
    expect('evidence' in rec).toBe(false)
    expect(rec.failureReason).toBe('over-quota')
  })
})

describe('C · the successful path is unchanged', () => {
  it('still persists answer, evidence and steps as before', async () => {
    const rec = await persisted({
      ok: true,
      answer: { headline: 'h', claims: [{ claimClass: 'FACT', text: 'f', entityEvidence: ['1517'] }], unknown: null },
      evidence: [{ kind: 'lead', refId: '1517' }],
      steps: 2,
      stopReason: 'answered',
      investigationId: 'inv_ok',
      costUsd: 0.04,
    })
    expect(rec.status).toBe('answered')
    expect(rec.steps).toBe(2)
    expect(rec.evidence).toHaveLength(1)
    expect(rec.answer).toBeDefined()
  })
})

describe('D · no bare persistence swallow was introduced', () => {
  it('investigationAdmission still routes every write through persist()', () => {
    const src = readFileSync('lib/ai/integration/investigationAdmission.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.split('//')[0])
      .join('\n')
    expect(src).not.toContain('.catch(() => undefined)')
    expect(src).not.toContain('.catch(() => null)')
    for (const op of ['settle', 'recordInvestigation', 'recordCoverage']) {
      expect(src).toContain(`persist('${op}'`)
    }
  })
})
