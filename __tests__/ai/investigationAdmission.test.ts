/**
 * Phase 4.2 — preconditions, admission, and the boundaries that make it safe.
 *
 * Pure; runs under `test:unit` with every I/O dependency injected. The storage
 * guarantees live in `__tests__/runtime/spendReservations.test.ts` against real
 * PostgreSQL — what is proven here is the POLICY: that nothing costs anything
 * until every precondition passes, that a capacity decline is not a failure, that
 * a judgement is never retried, and that no provider, Agent loop, or delivery path
 * is reachable from any Phase 4.2 module.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  admitInvestigation,
  reclaimExpiredReservations,
  DEFAULT_LEASE_MS,
  type AdmissionDeps,
} from '@/lib/ai/integration/investigationAdmission'
import { checkPreconditions, EXPECTED_STATE, DEFAULT_REFRACTORY_MS } from '@/lib/ai/integration/preconditions'
import { DETECTORS, type ExpectationKind } from '@/lib/ai/integration/detectors/registry'
import { isOwnedByDeterministicNotification } from '@/lib/ai/integration/notificationOwnership'
import type { SignalJob } from '@/db/ai/signalJobs'
import type { AgentScope } from '@/lib/agent/types'
import type { LeadFact } from '@/lib/today/types'

const NOW = new Date('2026-08-25T10:00:00.000Z')
/** Yesterday, in business-day terms — so classifyLead sees FOLLOWUP_OVERDUE. */
const OVERDUE_AT = Date.parse('2026-08-23T08:00:00.000Z')

const SCOPE: AgentScope = {
  agencyId: 8801,
  userId: 42,
  role: 'user' as AgentScope['role'],
  gotPermIds: [42],
  plan: 'pro' as AgentScope['plan'],
  firstName: 'דנה',
}

function job(over: Partial<SignalJob> = {}): SignalJob {
  return {
    id: 7,
    agencyId: 8801,
    observationKey: 'followup.overdue:lead:100:at:2026-08-23',
    expectation: 'followup.overdue',
    subjectType: 'lead',
    subjectId: '100',
    signal: {} as SignalJob['signal'],
    status: 'leased',
    attempts: 1,
    maxAttempts: 3,
    detectedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    ...over,
  }
}

/** A lead that classifyLead will genuinely classify as FOLLOWUP_OVERDUE. */
function fact(over: Partial<LeadFact> = {}): LeadFact {
  return {
    id: 100,
    name: null,
    phone: null,
    status: 'open',
    leadSource: 'manual',
    createdAt: OVERDUE_AT,
    nextFollowUpAt: OVERDUE_AT,
    lastActivityAt: OVERDUE_AT,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
    ...over,
  }
}

/** Preconditions with every I/O stubbed. P1 uses the REAL ownership registry. */
function preDeps(over: Partial<Parameters<typeof checkPreconditions>[1]> = {}) {
  return {
    now: NOW,
    deps: {
      readLeadFact: vi.fn(async () => fact()),
      lastReservationForSubject: vi.fn(async () => null),
      resolveAutonomousScope: vi.fn(async () => ({ ok: true as const, scope: SCOPE })),
    },
    ...over,
  }
}

/**
 * The same, with the expectation declared UNOWNED — the shape a future detector
 * will have once it observes something the deterministic engine does not deliver.
 * Only this makes P2–P5 reachable; with today's single owned expectation, P1
 * correctly short-circuits everything.
 */
function unownedDeps(over: { deps?: Record<string, unknown> } & Record<string, unknown> = {}) {
  const base = preDeps()
  return {
    ...base,
    ...over,
    deps: { ...base.deps, isOwnedByDeterministicNotification: () => false, ...(over.deps ?? {}) },
  } as Parameters<typeof checkPreconditions>[1]
}

/** Preconditions that pass, so the admission reaches the reservation. */
const passingPre = () =>
  vi.fn(async () => ({
    proceed: true as const,
    scope: SCOPE,
    state: 'FOLLOWUP_OVERDUE' as const,
    operatorUserId: 42,
    value: {
      state: 'FOLLOWUP_OVERDUE',
      ownedByDeterministicNotification: false,
      expectedByMs: OVERDUE_AT,
      clock: { nowMs: NOW.getTime(), dayStart: OVERDUE_AT, dayEnd: NOW.getTime() + 86_400_000 },
      vigilance: null,
    },
  }))

/** An Agent that answers with one grounded FACT citing the subject lead. */
const answeringAgent = () =>
  vi.fn(async () => ({
    ok: true as const,
    answer: {
      headline: 'h',
      claims: [{ claimClass: 'FACT' as const, text: 'f', entityEvidence: ['100'] }],
      unknown: null,
    },
    evidence: [{ kind: 'lead' as const, refId: '100' }],
    steps: 2,
    stopReason: 'answered' as const,
    investigationId: 'inv_test',
    costUsd: 0.031,
  }))

// ───────────── P1 is first, and free ─────────────

describe('P1 · deterministic notification ownership is the first and cheapest gate', () => {
  it('declines an owned expectation without touching a single dependency', async () => {
    const deps = preDeps()
    const r = await checkPreconditions(job(), deps)
    expect(r.proceed).toBe(false)
    expect(r.proceed === false && r.code).toBe('owned_by_deterministic_notification')
    // The whole point: nothing was read, so nothing could have cost anything.
    expect(deps.deps.readLeadFact).not.toHaveBeenCalled()
    expect(deps.deps.lastReservationForSubject).not.toHaveBeenCalled()
    expect(deps.deps.resolveAutonomousScope).not.toHaveBeenCalled()
  })

  /**
   * Wave 1 changed this deliberately, so the test now states the RULE rather
   * than an outcome that happened to be universal.
   *
   * Before it, every registered expectation was owned by a deterministic
   * notification, so P1 declined all of them and nothing ever reached
   * investigation. `conversation.objection` and `conversation.stalled` are the
   * first expectations nothing deterministic delivers — no emitter tells a rep
   * that a customer pushed back, or that an engaged thread went quiet — so they
   * are the first that may legitimately pass P1.
   *
   * Passing P1 is not permission to surface: P2–P5 still run, the Value Bar
   * still decides, and the reachable outcomes remain `recommend`/`stay_silent`.
   */
  it('an OWNED expectation is declined at P1; an unowned one is allowed past it', async () => {
    for (const expectation of Object.keys(DETECTORS)) {
      const owned = isOwnedByDeterministicNotification(expectation as ExpectationKind)
      const r = await checkPreconditions(job({ expectation }), preDeps())
      if (owned) {
        expect(r.proceed).toBe(false)
        expect(r.proceed === false && r.code).toBe('owned_by_deterministic_notification')
      } else {
        // Whatever P2–P5 then decide, the refusal must not be ownership.
        expect(r.proceed === false && r.code).not.toBe('owned_by_deterministic_notification')
      }
    }
  })

  it('an undeclared expectation is a permanent judgement, not an error', async () => {
    const r = await checkPreconditions(job({ expectation: 'cadence.break' }), preDeps())
    expect(r.proceed).toBe(false)
    expect(r.proceed === false && r.detail).toContain('undeclared expectation')
  })
})

// ───────────── P2–P5, each failing alone ─────────────

describe('P2–P5 each decline for their own reason', () => {
  it('P2 · a subject already taken this pass is coalesced, before any query', async () => {
    const deps = unownedDeps({ claimedSubjects: new Set(['100']) })
    const r = await checkPreconditions(job(), deps)
    expect(r.proceed === false && r.code).toBe('coalesced_into_sibling')
    expect(
      (deps.deps as { lastReservationForSubject: ReturnType<typeof vi.fn> }).lastReservationForSubject,
    ).not.toHaveBeenCalled()
  })

  it('P3 · a subject looked at inside the refractory window is declined', async () => {
    const recent = { createdAt: new Date(NOW.getTime() - 60_000).toISOString() }
    const deps = unownedDeps({ deps: { lastReservationForSubject: vi.fn(async () => recent) } })
    const r = await checkPreconditions(job(), deps)
    expect(r.proceed === false && r.code).toBe('within_refractory_window')
  })

  it('P3 · outside the window it proceeds', async () => {
    const old = { createdAt: new Date(NOW.getTime() - DEFAULT_REFRACTORY_MS - 1000).toISOString() }
    const deps = unownedDeps({ deps: { lastReservationForSubject: vi.fn(async () => old) } })
    expect((await checkPreconditions(job(), deps)).proceed).toBe(true)
  })

  it('P4 · a vanished / terminal / over-quota lead is declined', async () => {
    const deps = unownedDeps({ deps: { readLeadFact: vi.fn(async () => null) } })
    const r = await checkPreconditions(job(), deps)
    expect(r.proceed === false && r.code).toBe('state_no_longer_holds')
    expect(r.proceed === false && r.detail).toContain('gone, terminal, or over quota')
  })

  it('P4 · classifyLead is the SOLE classifier — an inbound outranks a passed deadline', async () => {
    // Same lead, same passed nextFollowUpAt. A hand-rolled `nextFollowUpAt <
    // dayStart` would call this overdue; classifyLead calls it WAITING_REPLY,
    // because the rep owes a reply. That difference IS the reason for reuse.
    const waiting = fact({ lastInboundAt: NOW.getTime() - 1000, lastHumanOutboundAt: null })
    const deps = unownedDeps({ deps: { readLeadFact: vi.fn(async () => waiting) } })
    const r = await checkPreconditions(job(), deps)
    expect(r.proceed).toBe(false)
    expect(r.proceed === false && r.detail).toContain('WAITING_REPLY')
  })

  it('P4 · a still-overdue lead proceeds', async () => {
    expect((await checkPreconditions(job(), unownedDeps())).proceed).toBe(true)
  })

  it('P5 · no resolvable operator declines, and no scope is invented', async () => {
    for (const reason of ['no_operator', 'not_entitled', 'operator_unreadable'] as const) {
      const deps = unownedDeps({
        deps: { resolveAutonomousScope: vi.fn(async () => ({ ok: false as const, reason })) },
      })
      const r = await checkPreconditions(job(), deps)
      expect(r.proceed === false && r.code).toBe('no_operator')
      expect(r.proceed === false && r.detail).toBe(reason)
    }
  })

  it('a portfolio subject is never investigable', async () => {
    const deps = unownedDeps()
    const r = await checkPreconditions(job({ subjectType: 'portfolio', subjectId: 'p1' }), deps)
    expect(r.proceed === false && r.detail).toContain('not investigable')
  })

  it('on success it carries the operator that governs BOTH evidence and delivery', async () => {
    const r = await checkPreconditions(job(), unownedDeps())
    expect(r.proceed).toBe(true)
    expect(r.proceed === true && r.operatorUserId).toBe(SCOPE.userId)
    expect(r.proceed === true && r.scope.agencyId).toBe(job().agencyId)
  })

  it('the expectation→state map is total over every declared detector', () => {
    expect(Object.keys(EXPECTED_STATE).sort()).toEqual(Object.keys(DETECTORS).sort())
  })
})

// ───────────── I9 · nothing is reserved until preconditions pass ─────────────

describe('I9 · preconditions run before any reservation', () => {
  const spies = () => ({
    reserve: vi.fn(async () => ({ reserved: false as const, reason: 'unconfigured' as const })),
    release: vi.fn(async () => true),
    settle: vi.fn(async () => true),
  })

  it('a precondition decline never reserves, and never retries', async () => {
    const s = spies()
    const r = await admitInvestigation(job(), { now: NOW, deps: s as unknown as AdmissionDeps })
    expect(r.outcome).toBe('declined_precondition')
    expect(r.preconditionCode).toBe('owned_by_deterministic_notification')
    expect(r.jobDisposition).toBe('succeed') // judgement — never retried
    expect(s.reserve).not.toHaveBeenCalled()
    expect(s.settle).not.toHaveBeenCalled()
  })

  it('an admitted job reserves exactly once, with the lease as its expiry', async () => {
    const reserve = vi.fn(async () => ({ reserved: true as const, row: { id: 99 } }))
    const deps = {
      reserve,
      settle: vi.fn(async () => true),
      isReservationActive: vi.fn(async () => true),
      checkPreconditions: passingPre(),
      runAgent: answeringAgent(),
      decide: vi.fn(() => ({ emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' }, trace: [] })),
      recordInvestigation: vi.fn(async () => undefined),
      recordCoverage: vi.fn(async () => 1),
    }
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(reserve).toHaveBeenCalledTimes(1)
    const arg = (reserve.mock.calls as unknown as Array<[{ expiresAt: Date; operatorUserId: number }]>)[0]![0]
    expect(arg.expiresAt.getTime()).toBe(NOW.getTime() + DEFAULT_LEASE_MS)
    expect(arg.operatorUserId).toBe(42)
    expect(r.jobDisposition).toBe('succeed')
  })
})

// ───────── B1 · no GPT call without an active durable reservation ──────────

describe('B1 · the model is unreachable without a held reservation', () => {
  it('a precondition decline never reaches the Agent', async () => {
    const runAgent = vi.fn()
    await admitInvestigation(job(), {
      now: NOW,
      deps: { runAgent, reserve: vi.fn(), settle: vi.fn() } as unknown as AdmissionDeps,
    })
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('a capacity decline never reaches the Agent', async () => {
    const runAgent = vi.fn()
    const r = await admitInvestigation(job(), {
      now: NOW,
      deps: {
        runAgent,
        checkPreconditions: passingPre(),
        reserve: vi.fn(async () => ({ reserved: false as const, reason: 'slot_busy' as const })),
        settle: vi.fn(),
      } as unknown as AdmissionDeps,
    })
    expect(runAgent).not.toHaveBeenCalled()
    expect(r.jobDisposition).toBe('leave_pending')
  })
})

// ───────── B7 · spend settled on every terminal path ──────────────────────

describe('B7 · every terminal path settles the hold', () => {
  const withAgent = (agent: unknown, decideFn?: unknown) => {
    const settle = vi.fn(async () => true)
    const deps = {
      reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 99 } })),
      settle,
      isReservationActive: vi.fn(async () => true),
      checkPreconditions: passingPre(),
      runAgent: agent,
      decide:
        decideFn ?? vi.fn(() => ({ emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' }, trace: [] })),
      recordInvestigation: vi.fn(async () => undefined),
      recordCoverage: vi.fn(async () => 1),
    }
    return { settle, deps }
  }

  it('settles the ACTUAL cost after a successful run', async () => {
    const { settle, deps } = withAgent(answeringAgent())
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(settle).toHaveBeenCalledWith(99, 0.031, 'admitted')
    expect(r.costUsd).toBeCloseTo(0.031, 6)
  })

  it('settles after a validator REFUSAL, and does not retry it', async () => {
    const refusing = vi.fn(async () => ({
      ok: false as const,
      reason: 'no_evidence' as const,
      investigationId: 'i',
      costUsd: 0.02,
    }))
    const { settle, deps } = withAgent(refusing)
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(settle).toHaveBeenCalledWith(99, 0.02, 'admitted')
    expect(r.outcome).toBe('refused')
    expect(r.jobDisposition).toBe('succeed') // judgement — never retried
  })

  it('settles after a PROVIDER THROW, and retries it as transport', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('provider down')
    })
    const { settle, deps } = withAgent(throwing)
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(settle).toHaveBeenCalledWith(99, 0, 'admitted')
    expect(r.outcome).toBe('transport_failed')
    expect(r.jobDisposition).toBe('fail') // transport — retried
  })

  it('treats gate_denied as CAPACITY, leaving the job pending', async () => {
    const denied = vi.fn(async () => ({
      ok: false as const,
      reason: 'gate_denied' as const,
      message: 'over-quota',
      investigationId: 'i',
      costUsd: 0,
    }))
    const { deps } = withAgent(denied)
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(r.jobDisposition).toBe('leave_pending')
  })
})

// ───────── B10 · surface intent · B11 · lease still active ────────────────

describe('B10 · the gate is always entered in surface mode', () => {
  it('passes intent.mode surface with the precondition ValueContext', async () => {
    const decide = vi.fn(() => ({ emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' }, trace: [] }))
    await admitInvestigation(job(), {
      now: NOW,
      deps: {
        reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 99 } })),
        settle: vi.fn(async () => true),
        isReservationActive: vi.fn(async () => true),
        checkPreconditions: passingPre(),
        runAgent: answeringAgent(),
        decide,
        recordInvestigation: vi.fn(async () => undefined),
        recordCoverage: vi.fn(async () => 1),
      } as unknown as AdmissionDeps,
    })
    const ctx = (decide.mock.calls as unknown as Array<[unknown, { intent: { mode: string; value: unknown } }]>)[0]![1]
    expect(ctx.intent.mode).toBe('surface')
    expect(ctx.intent.value).toMatchObject({ state: 'FOLLOWUP_OVERDUE', ownedByDeterministicNotification: false })
  })
})

describe('B11 · a Recommend is discarded when the hold is gone', () => {
  const recommending = () => vi.fn(() => ({ emitted: true, outcome: 'recommend', recommendation: {}, trace: [] }))

  it('records the Recommend while the reservation is active', async () => {
    const recordCoverage = vi.fn(async () => 1)
    const r = await admitInvestigation(job(), {
      now: NOW,
      deps: {
        reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 99 } })),
        settle: vi.fn(async () => true),
        isReservationActive: vi.fn(async () => true),
        checkPreconditions: passingPre(),
        runAgent: answeringAgent(),
        decide: recommending(),
        recordInvestigation: vi.fn(async () => undefined),
        recordCoverage,
      } as unknown as AdmissionDeps,
    })
    expect(r.outcome).toBe('recommended')
    expect(recordCoverage).toHaveBeenCalled()
  })

  it('discards it when the lease expired mid-investigation', async () => {
    const recordCoverage = vi.fn(async () => 1)
    const r = await admitInvestigation(job(), {
      now: NOW,
      deps: {
        reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 99 } })),
        settle: vi.fn(async () => true),
        isReservationActive: vi.fn(async () => false),
        checkPreconditions: passingPre(),
        runAgent: answeringAgent(),
        decide: recommending(),
        recordInvestigation: vi.fn(async () => undefined),
        recordCoverage,
      } as unknown as AdmissionDeps,
    })
    expect(r.outcome).toBe('gate_rejected')
    expect(r.detail).toContain('no longer active')
    expect(recordCoverage).not.toHaveBeenCalled()
  })
})

// ───────────── I6 · capacity is not failure ─────────────

describe('I6 · a capacity decline leaves the job pending and consumes no attempt', () => {
  const capacityCase = async (reason: 'unconfigured' | 'daily_cap' | 'slot_busy') => {
    const deps = {
      reserve: vi.fn(async () => ({ reserved: false as const, reason })),
      release: vi.fn(async () => true),
      settle: vi.fn(async () => true),
      checkPreconditions: vi.fn(async () => ({
        proceed: true as const,
        scope: SCOPE,
        state: 'FOLLOWUP_OVERDUE' as const,
        operatorUserId: 42,
      })),
    }
    return {
      result: await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps }),
      deps,
    }
  }

  for (const reason of ['unconfigured', 'daily_cap', 'slot_busy'] as const) {
    it(`${reason} → leave_pending, never succeed, never settle`, async () => {
      const { result, deps } = await capacityCase(reason)
      expect(result.outcome).toBe('declined_capacity')
      expect(result.capacityReason).toBe(reason)
      // The whole retry contract, in one field: the caller must NOT mark this
      // succeeded and must NOT consume an attempt.
      expect(result.jobDisposition).toBe('leave_pending')
      expect(deps.settle).not.toHaveBeenCalled()
    })
  }

  it('capacity and judgement are the only two dispositions, and they differ', async () => {
    const cap = (await capacityCase('slot_busy')).result
    const judgement = await admitInvestigation(job(), {
      now: NOW,
      deps: { reserve: vi.fn(), release: vi.fn(), settle: vi.fn() } as unknown as AdmissionDeps,
    })
    expect(cap.jobDisposition).toBe('leave_pending')
    expect(judgement.jobDisposition).toBe('succeed')
    expect(cap.jobDisposition).not.toBe(judgement.jobDisposition)
  })
})

// ───────────── Phase 4.2 spends nothing ─────────────

describe('the expiry sweep is still delegated to the ledger', () => {
  it('reclaimExpiredReservations calls releaseExpired with the clock it was given', async () => {
    const releaseExpired = vi.fn(async () => 3)
    expect(await reclaimExpiredReservations(NOW, { releaseExpired } as unknown as AdmissionDeps)).toBe(3)
    expect(releaseExpired).toHaveBeenCalledWith(NOW)
  })
})

// ───────────── I7, I10, I11, I12 · boundaries ─────────────

describe('boundaries — no provider, no Agent loop, no delivery, no second classifier', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  /**
   * CODE ONLY — block and line comments removed.
   *
   * A "this module must never do X" assertion that reads the raw file tests the
   * documentation, not the module: these headers explain at length what they do
   * NOT do, and every such sentence is a false positive. Stripping comments makes
   * the assertion test the thing it claims to.
   */
  const code = (p: string) =>
    read(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const FILES = [
    'lib/ai/integration/investigationAdmission.ts',
    'lib/ai/integration/preconditions.ts',
    'lib/ai/integration/autonomousScope.ts',
    'db/ai/spendReservations.ts',
  ]
  const imports = (p: string) => [...read(p).matchAll(/^import[^']*from '([^']+)'/gm)].map((m) => m[1]!)

  it('I11 · the provider is reachable from EXACTLY ONE module, and only via the Agent runtime', () => {
    // Phase 4.3 authorized one edge and one only: the admission orchestrator
    // invokes the existing Agent rather than building a second one.
    for (const f of FILES.filter((f) => !f.endsWith('investigationAdmission.ts'))) {
      expect(code(f)).not.toMatch(/@ai-sdk|from 'ai'|generateText|runStructured|admitAiRun|lib\/agent\/run|lib\/agent\/tools/)
    }
    const admission = code('lib/ai/integration/investigationAdmission.ts')
    // It reaches the Agent LOOP, and nothing beneath it: no SDK, no router, no
    // provider, no tool surface, no second prompt.
    expect(admission).toMatch(/from '@\/lib\/agent\/run'/)
    expect(admission).not.toMatch(/@ai-sdk|from 'ai'|generateText|runStructured|admitAiRun|lib\/agent\/tools|lib\/agent\/prompt/)
  })

  it('B12 · the autonomous path never resolves a session', () => {
    for (const f of FILES) {
      expect(code(f)).not.toMatch(/resolveAgentScope|requireProductAccess|requireUser/)
    }
    // The scope it passes came from resolveRecipients, via Phase 4.2.
    expect(code('lib/ai/integration/investigationAdmission.ts')).toMatch(/scope: pre\.scope/)
  })

  it('I12 · no notification delivery is importable', () => {
    for (const f of FILES) {
      expect(code(f)).not.toMatch(/notifyEvent|enqueueNotification|deliverWebPush|notifications\/emit|notifications\/worker/)
    }
  })

  it('I7 · autonomous scope resolves through resolveRecipients, not a private rule', () => {
    const src = read('lib/ai/integration/autonomousScope.ts')
    expect(src).toMatch(/resolveRecipients/)
    expect(src).toMatch(/buildRecipientContext/)
    expect(src).toMatch(/rule: 'handler_or_admin'/)
    // No hand-rolled fan-out: the engine's own rule, or nothing.
    expect(code('lib/ai/integration/autonomousScope.ts')).not.toMatch(/whereIn\('role'|user_perms|ADMIN_ROLES/)
  })

  it('I7 · scope entitlement is sessionless — requireProductAccess is never called', () => {
    expect(read('lib/ai/integration/autonomousScope.ts')).toMatch(/resolveAiAccess/)
    expect(code('lib/ai/integration/autonomousScope.ts')).not.toMatch(/requireProductAccess|requireUser/)
  })

  it('I10 · classifyLead is the sole state classifier', () => {
    expect(read('lib/ai/integration/preconditions.ts')).toMatch(/import \{ classifyLead \}/)
    // No re-derived predicate: the bug the detector header warns about.
    expect(code('lib/ai/integration/preconditions.ts')).not.toMatch(
      /nextFollowUpAt\s*[<>]|isTerminal\(|TERMINAL_STATUSES|STATE_PRIORITY/,
    )
  })

  it('the business day comes from the sole time authority, never a raw clock', () => {
    expect(read('lib/ai/integration/preconditions.ts')).toMatch(/businessDayBounds/)
    expect(code('lib/ai/integration/preconditions.ts')).not.toMatch(/setHours\(|startOfDay/)
  })

  it('agency identity is a parameter read from the job, never a session or request', () => {
    for (const f of FILES) {
      expect(code(f)).not.toMatch(/headers\(\)|cookies\(\)|req\.|request\.|searchParams/)
    }
  })

  it('B9 · the worker gives a job to exactly one path, behind the gate', () => {
    const worker = code('lib/ai/integration/signalWorker.ts')
    // Gated, and the gate is consulted BEFORE the branch is entered.
    expect(worker).toMatch(/isInvestigationEnabled\(job\.agencyId\)/)
    // A job the autonomous path finished is never also run deterministically.
    expect(worker).toMatch(/continue/)
    expect(worker).toMatch(/verdict\.outcome !== 'declined_precondition'/)
    // Capacity gives the attempt back rather than failing the job.
    expect(worker).toMatch(/releaseClaim\(job\.id\)/)
    expect(worker).not.toMatch(/notifyEvent|deliverWebPush/)
  })

  it('the ledger depends on nothing but the database', () => {
    for (const i of imports('db/ai/spendReservations.ts')) {
      expect(i === '@/config/db' || i === 'knex').toBe(true)
    }
  })
})

// ───────── B9 · one job, exactly one path ─────────────────────────────────

describe('B9 · the deterministic path never also runs for an investigated job', () => {
  const workerDeps = (admitOutcome: string, disposition: string) => ({
    claim: vi.fn(async () => [job()]),
    succeed: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
    deadLetter: vi.fn(async () => undefined),
    reclaim: vi.fn(async () => 0),
    releaseClaim: vi.fn(async () => true),
    interpret: vi.fn(() => ({
      accepted: true as const,
      event: {
        kind: 'absence_detected' as const,
        signal: { scope: { agencyId: 8801 }, subject: { subjectType: 'lead', subjectId: '100' }, asOfTime: NOW.toISOString() },
      },
    })),
    reason: vi.fn(async () => ({ scope: { agencyId: 8801 }, questions: [], isGrounded: false }) as never),
    decide: vi.fn(() => ({ emitted: true, outcome: 'stay_silent', silence: { reason: 'x' }, trace: [] }) as never),
    record: vi.fn(async () => 1),
    admitInvestigation: vi.fn(async () => ({
      outcome: admitOutcome,
      jobDisposition: disposition,
      costUsd: 0,
      detail: 'd',
    })),
  })

  it('an investigated job does NOT reach the deterministic reason/decide/record path', async () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = '8801'
    try {
      const deps = workerDeps('silent', 'succeed')
      const { runSignalWorker } = await import('@/lib/ai/integration/signalWorker')
      const summary = await runSignalWorker({ now: NOW, limit: 1, deps: deps as never })
      expect(deps.admitInvestigation).toHaveBeenCalledTimes(1)
      expect(summary.investigated).toBe(1)
      // The whole point: the deterministic pass is skipped entirely.
      expect(deps.reason).not.toHaveBeenCalled()
      expect(deps.decide).not.toHaveBeenCalled()
      expect(deps.record).not.toHaveBeenCalled()
      expect(deps.succeed).toHaveBeenCalledWith(7)
    } finally {
      delete process.env.SIGNAL_INVESTIGATE_AGENCY_IDS
    }
  })

  it('a capacity decline releases the claim and runs NEITHER path', async () => {
    process.env.SIGNAL_INVESTIGATE_AGENCY_IDS = '8801'
    try {
      const deps = workerDeps('declined_capacity', 'leave_pending')
      const { runSignalWorker } = await import('@/lib/ai/integration/signalWorker')
      const summary = await runSignalWorker({ now: NOW, limit: 1, deps: deps as never })
      expect(deps.releaseClaim).toHaveBeenCalledWith(7)
      expect(deps.succeed).not.toHaveBeenCalled()
      expect(deps.fail).not.toHaveBeenCalled()
      expect(deps.reason).not.toHaveBeenCalled()
      expect(summary.capacityDeferred).toBe(1)
    } finally {
      delete process.env.SIGNAL_INVESTIGATE_AGENCY_IDS
    }
  })

  it('with the gate UNSET the autonomous path is never entered at all', async () => {
    delete process.env.SIGNAL_INVESTIGATE_AGENCY_IDS
    const deps = workerDeps('silent', 'succeed')
    const { runSignalWorker } = await import('@/lib/ai/integration/signalWorker')
    await runSignalWorker({ now: NOW, limit: 1, deps: deps as never })
    expect(deps.admitInvestigation).not.toHaveBeenCalled()
    // The deterministic path runs exactly as it did before Phase 4.3.
    expect(deps.reason).toHaveBeenCalled()
  })
})

// ───────── C7 · only a Recommend becomes an insight ───────────────────────

describe('C7 · the Value Bar remains authoritative over whether an insight exists', () => {
  const withDecision = (outcome: string) => {
    const emitInsight = vi.fn(async () => ({ outcome: 'delivered', detail: 'd' }))
    const decision =
      outcome === 'recommend'
        ? { emitted: true, outcome: 'recommend', recommendation: { reasoningChain: [] }, trace: [] }
        : outcome === 'stay_silent'
          ? { emitted: true, outcome: 'stay_silent', silence: { reason: 'below_value_bar' }, trace: [] }
          : { emitted: false, outcome: null, rejection: { boundary: 'provenance' }, trace: [] }
    return {
      emitInsight,
      deps: {
        reserve: vi.fn(async () => ({ reserved: true as const, row: { id: 99 } })),
        settle: vi.fn(async () => true),
        isReservationActive: vi.fn(async () => true),
        checkPreconditions: passingPre(),
        runAgent: answeringAgent(),
        decide: vi.fn(() => decision),
        recordInvestigation: vi.fn(async () => undefined),
        recordCoverage: vi.fn(async () => 1),
        emitInsight,
      },
    }
  }

  it('a recommend emits exactly one insight, carrying the reasoning chain', async () => {
    const { emitInsight, deps } = withDecision('recommend')
    await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(emitInsight).toHaveBeenCalledTimes(1)
    const arg = (emitInsight.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]
    expect(arg.operatorUserId).toBe(42)
    expect(arg.expectation).toBe('followup.overdue')
    expect(Array.isArray(arg.evidence)).toBe(true)
    expect(Array.isArray(arg.reasoningChain)).toBe(true)
  })

  it('a stay_silent emits NOTHING', async () => {
    const { emitInsight, deps } = withDecision('stay_silent')
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(emitInsight).not.toHaveBeenCalled()
    expect(r.outcome).toBe('silent')
  })

  it('a gate rejection emits NOTHING', async () => {
    const { emitInsight, deps } = withDecision('rejected')
    const r = await admitInvestigation(job(), { now: NOW, deps: deps as unknown as AdmissionDeps })
    expect(emitInsight).not.toHaveBeenCalled()
    expect(r.outcome).toBe('gate_rejected')
  })

  it('an insight failure never fails the investigation — the run is already paid for', async () => {
    const { deps } = withDecision('recommend')
    const throwing = {
      ...deps,
      emitInsight: vi.fn(async () => {
        throw new Error('insight table down')
      }),
    }
    const r = await admitInvestigation(job(), { now: NOW, deps: throwing as unknown as AdmissionDeps })
    expect(r.jobDisposition).toBe('succeed')
    expect(r.detail).toContain('insight-failed')
  })
})
