/**
 * Persistence failures must be OBSERVABLE — the defect that hid a real loss.
 *
 * On 2026-08-26 an externally poisoned read-only connection (SQLSTATE 25006) made
 * `settle` and `recordInvestigation` fail for investigation inv_mtadvvv4_34yip1.
 * $0.011825 of provider spend was genuinely billed, `ai_spend_reservations` was
 * later released with `spentUsd = NULL`, `ai_investigations` stayed empty — and
 * every one of those failures was swallowed by `.catch(() => undefined)`. Not one
 * log line said anything. The loss was discoverable only by querying production.
 *
 * These tests assert the two halves of the fix that matter:
 *   1. every durable write after the Agent returns emits a PERSISTENCE_FAILED
 *      trace carrying enough identity to diagnose it, and
 *   2. the flow's BEHAVIOUR is unchanged — a persistence fault still never fails
 *      the investigation, because the model call is already paid for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { admitInvestigation, type AdmissionDeps } from '@/lib/ai/integration/investigationAdmission'
import type { SignalJob } from '@/db/ai/signalJobs'
import type { AgentScope } from '@/lib/agent/types'

const NOW = new Date('2026-08-26T17:44:42.000Z')

const SCOPE: AgentScope = {
  agencyId: 103,
  userId: 332,
  role: 'ADMIN' as AgentScope['role'],
  gotPermIds: [],
  plan: 'pro' as AgentScope['plan'],
  firstName: 'עלמה',
}

/** The real production job, shape for shape. */
function job(over: Partial<SignalJob> = {}): SignalJob {
  return {
    id: 20380,
    agencyId: 103,
    observationKey: 'sla.open_loop:lead:1499:at:2026-08-26T09:00:00.000Z',
    expectation: 'sla.open_loop',
    subjectType: 'lead',
    subjectId: '1499',
    signal: { absence: { expectedBy: '2026-08-26T09:00:00.000Z' } } as SignalJob['signal'],
    status: 'leased',
    attempts: 1,
    maxAttempts: 3,
    detectedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    ...over,
  }
}

const passingPre = () =>
  vi.fn(async () => ({
    proceed: true as const,
    scope: SCOPE,
    state: 'OPEN_LOOP_SLA' as const,
    operatorUserId: 332,
    value: {
      state: 'OPEN_LOOP_SLA',
      ownedByDeterministicNotification: false,
      expectedByMs: Date.parse('2026-08-26T09:00:00.000Z'),
      clock: { nowMs: NOW.getTime(), dayStart: NOW.getTime() - 3.6e6, dayEnd: NOW.getTime() + 3.6e6 },
      vigilance: 'dropped_commitment' as const,
    },
  }))

const reserving = () => vi.fn(async () => ({ reserved: true as const, row: { id: 1 } as never }))

/** The exact production outcome: generation succeeded, validator refused. */
const refusingAgent = () =>
  vi.fn(async () => ({
    ok: false as const,
    reason: 'no_evidence' as const,
    investigationId: 'inv_mtadvvv4_34yip1',
    costUsd: 0.011825,
  }))

/** The production fault: Postgres 25006. */
function readOnlyError(): Error & { code: string } {
  const e = new Error('cannot execute UPDATE in a read-only transaction') as Error & { code: string }
  e.code = '25006'
  return e
}

let logs: string[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logs = []
  spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.join(' '))
  })
})
afterEach(() => spy.mockRestore())

/** Every PERSISTENCE_FAILED record emitted during a run. */
function failures(): Record<string, unknown>[] {
  return logs
    .filter((l) => l.startsWith('[AGENT-TRACE] PERSISTENCE_FAILED'))
    .map((l) => JSON.parse(l.slice(l.indexOf('{'))) as Record<string, unknown>)
}

describe('a failed settle is reported, with enough identity to find the money', () => {
  it('emits PERSISTENCE_FAILED carrying operation, ids and the SQLSTATE', async () => {
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: vi.fn(async () => {
        throw readOnlyError()
      }),
      recordInvestigation: vi.fn(async () => undefined as never),
    }

    await admitInvestigation(job(), { now: NOW, deps })

    const f = failures().find((r) => r.operation === 'settle')
    expect(f, 'a swallowed settle must not be silent').toBeDefined()
    expect(f!.investigationId).toBe('inv_mtadvvv4_34yip1')
    expect(f!.agencyId).toBe(103)
    expect(f!.signalJobId).toBe(20380)
    expect(f!.reservationId).toBe(1)
    expect(f!.errorCode).toBe('25006')
    expect(String(f!.error)).toMatch(/read-only transaction/)
  })

  it('the trace carries NO answer text, claim text or connection string', async () => {
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: vi.fn(async () => {
        throw readOnlyError()
      }),
      recordInvestigation: vi.fn(async () => undefined as never),
    }
    await admitInvestigation(job(), { now: NOW, deps })
    const raw = logs.filter((l) => l.includes('PERSISTENCE_FAILED')).join('\n')
    for (const secret of ['postgres://', 'postgresql://', 'password', 'headline', 'claims', 'sslmode']) {
      expect(raw.toLowerCase()).not.toContain(secret.toLowerCase())
    }
  })
})

describe('a failed investigation record is reported', () => {
  it('recordInvestigation failure surfaces with the same identity', async () => {
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: vi.fn(async () => true),
      recordInvestigation: vi.fn(async () => {
        throw readOnlyError()
      }),
    }

    await admitInvestigation(job(), { now: NOW, deps })

    const f = failures().find((r) => r.operation === 'recordInvestigation')
    expect(f).toBeDefined()
    expect(f!.signalJobId).toBe(20380)
    expect(f!.agencyId).toBe(103)
    expect(f!.errorCode).toBe('25006')
  })

  it('BOTH failures are reported when both writes fail — the real production case', async () => {
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: vi.fn(async () => {
        throw readOnlyError()
      }),
      recordInvestigation: vi.fn(async () => {
        throw readOnlyError()
      }),
    }

    const r = await admitInvestigation(job(), { now: NOW, deps })

    expect(
      failures()
        .map((x) => x.operation)
        .sort(),
    ).toEqual(['recordInvestigation', 'settle'])
    // The verdict is still a judgement, and the real cost is still reported up.
    expect(r.outcome).toBe('refused')
    expect(r.jobDisposition).toBe('succeed')
    expect(r.costUsd).toBe(0.011825)
  })
})

describe('BEHAVIOUR IS UNCHANGED — observability only', () => {
  it('a persistence fault never throws out of admitInvestigation', async () => {
    const boom = vi.fn(async () => {
      throw readOnlyError()
    })
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: boom,
      recordInvestigation: boom,
      recordCoverage: boom,
    }
    await expect(admitInvestigation(job(), { now: NOW, deps })).resolves.toBeDefined()
  })

  it('a run whose writes all SUCCEED emits no PERSISTENCE_FAILED at all', async () => {
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: refusingAgent(),
      settle: vi.fn(async () => true),
      recordInvestigation: vi.fn(async () => undefined as never),
      recordCoverage: vi.fn(async () => undefined as never),
    }
    await admitInvestigation(job(), { now: NOW, deps })
    expect(failures()).toEqual([])
  })

  it('the transport-throw path still settles, records and fails the job', async () => {
    const settle = vi.fn(async () => true)
    const recordInvestigation = vi.fn(async () => undefined as never)
    const deps: AdmissionDeps = {
      checkPreconditions: passingPre(),
      reserve: reserving(),
      runAgent: vi.fn(async () => {
        throw new Error('provider exploded')
      }),
      settle,
      recordInvestigation,
    }

    const r = await admitInvestigation(job(), { now: NOW, deps })

    expect(settle).toHaveBeenCalledTimes(1)
    expect(recordInvestigation).toHaveBeenCalledTimes(1)
    expect(r.outcome).toBe('transport_failed')
    expect(r.jobDisposition).toBe('fail')
  })
})

describe('invariant · no durable write after the Agent may be silently swallowed', () => {
  it('investigationAdmission contains no bare .catch(() => undefined)', () => {
    const src = readFileSync('lib/ai/integration/investigationAdmission.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.split('//')[0])
      .join('\n')
    expect(src).not.toContain('.catch(() => undefined)')
    expect(src).not.toContain('.catch(() => null)')
  })

  it('every persistence dependency is routed through persist()', () => {
    const src = readFileSync('lib/ai/integration/investigationAdmission.ts', 'utf8')
    for (const op of ['settle', 'recordInvestigation', 'recordCoverage']) {
      expect(src, `${op} must be wrapped by persist()`).toContain(`persist('${op}'`)
    }
    // emitInsight keeps its own try/catch (it must set insightDetail), but must trace.
    expect(src).toContain("operation: 'emitInsight'")
  })
})
