/**
 * Phase 3 — the production tick, end to end (real PostgreSQL).
 *
 * One invocation of `runSignalTick` is exactly what Vercel Cron will call every
 * minute. These tests run it against live `signal_jobs` and `ai_shadow_coverage`
 * with the REAL runtime — M3, M4, M5 and M6 all execute, and only the CRM facts
 * read is injected (the runtime harness builds the ai_* tables, not `clients`;
 * that query's scope contract is proven in __tests__/ai/leadFactsScope.sql.test.ts).
 *
 * Runs under `test:runtime`.
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { runSignalTick } from '@/lib/ai/integration/signalTick'
import { readSignalJobs, claimSignalJobs } from '@/db/ai/signalJobs'
import { readCoverageDecisions } from '@/db/ai/shadowCoverage'
import { reason as realReason } from '@/lib/ai/runtime/reasoning'
import { businessDayBounds } from '@/lib/today/time'
import type { SignalSweepDeps } from '@/lib/ai/integration/signalSweep'
import type { SignalWorkerDeps } from '@/lib/ai/integration/signalWorker'
import type { CognitionRequest } from '@/lib/ai/runtime/scheduler'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await db('signal_jobs').del()
  await db('ai_shadow_coverage').del()
})

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const DAY = 86_400_000
const AGENCY = 9961

function overdueFact(id: number, daysOverdue = 2): LeadFact {
  return {
    id,
    name: null,
    phone: null,
    status: 'contacted',
    leadSource: 'manual',
    createdAt: ctx.nowMs - 30 * DAY,
    nextFollowUpAt: ctx.dayStart - daysOverdue * DAY,
    lastActivityAt: ctx.nowMs - 5 * DAY,
    lastInboundAt: null,
    lastHumanOutboundAt: null,
    hasOpenTask: false,
    earliestOpenTaskDueAt: null,
  }
}

function sweepDeps(facts: LeadFact[]): SignalSweepDeps {
  return { listAgencyLeadFacts: (async (_s: Scope) => facts) as SignalSweepDeps['listAgencyLeadFacts'] }
}

function tick(facts: LeadFact[], agencyIds = [AGENCY], worker?: SignalWorkerDeps) {
  return runSignalTick({
    now: NOW,
    agencyIds,
    sweep: { deps: sweepDeps(facts) },
    ...(worker ? { worker: { deps: worker } } : {}),
  })
}

// ── D · E · F · G · H · I. one tick, end to end ──────────────────────────────

describe('D–I · one tick carries a CRM fact to a durable decision', () => {
  it('detects, enqueues, claims, runs the ratified runtime, and completes the job', async () => {
    const s = await tick([overdueFact(77)])

    expect(s.skipped).toBe(false)
    expect(s.agencies).toBe(1)
    // D + E + F — the detector ran and produced exactly one enqueued observation.
    expect(s.sweep).toMatchObject({ agencies: 1, detected: 1, enqueued: 1, duplicates: 0, refused: 0, errored: 0 })
    // G + I — the worker claimed it and completed it.
    expect(s.worker).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, deadLettered: 0, decisions: 1, unrepresentable: 0 })

    const jobs = await readSignalJobs(AGENCY)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('succeeded')
    expect(jobs[0].attempts).toBe(1)

    const decisions = await readCoverageDecisions(AGENCY, { subjectType: 'lead', subjectId: '77' })
    expect(decisions).toHaveLength(1)
    expect(decisions[0].reason).toBe('absence')
    expect(decisions[0].outcome).toBe('stay_silent')
  })

  it('H · the request the runtime reasoned over was minted by RuntimeScheduler.admit()', async () => {
    const requests: CognitionRequest[] = []
    await tick([overdueFact(77)], [AGENCY], {
      reason: ((request: CognitionRequest, opts: Parameters<typeof realReason>[1] = {}) => {
        requests.push(request)
        return realReason(request, opts)
      }) as SignalWorkerDeps['reason'],
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].tier).toBe(2)
    expect(requests[0].reason).toBe('absence')
    expect(requests[0].trigger).toEqual({ kind: 'absence_detected', asOfTime: NOW.toISOString() })
    expect(requests[0].scope).toEqual({ agencyId: AGENCY })
    expect(requests[0].subject).toEqual({ subjectType: 'lead', subjectId: '77' })
  })

  it('a terminal lead never reaches the queue or the runtime', async () => {
    const s = await tick([{ ...overdueFact(77), status: 'closed' }])
    expect(s.sweep).toMatchObject({ detected: 0, enqueued: 0 })
    expect(s.worker).toMatchObject({ claimed: 0, decisions: 0 })
    expect(await readSignalJobs(AGENCY)).toHaveLength(0)
  })

  it('several agencies are carried through in one tick, each under its own scope', async () => {
    const s = await tick([overdueFact(77)], [9962, 9963])
    expect(s.agencies).toBe(2)
    expect(s.sweep.enqueued).toBe(2)
    expect(s.worker.succeeded).toBe(2)
    expect(await readCoverageDecisions(9962, { subjectType: 'lead', subjectId: '77' })).toHaveLength(1)
    expect(await readCoverageDecisions(9963, { subjectType: 'lead', subjectId: '77' })).toHaveLength(1)
  })
})

// ── L. repeated ticks are idempotent ─────────────────────────────────────────

describe('L · repeated ticks are idempotent', () => {
  it('a minute later, with the CRM unchanged, nothing new is created or processed', async () => {
    await tick([overdueFact(77)])
    const second = await runSignalTick({
      now: new Date(NOW.getTime() + 60_000),
      agencyIds: [AGENCY],
      sweep: { deps: sweepDeps([overdueFact(77)]) },
    })

    expect(second.sweep).toMatchObject({ detected: 1, enqueued: 0, duplicates: 1 })
    expect(second.worker).toMatchObject({ claimed: 0, succeeded: 0, decisions: 0 })
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
    expect(await readCoverageDecisions(AGENCY, { subjectType: 'lead', subjectId: '77' })).toHaveLength(1)
  })

  it('five consecutive ticks leave exactly one job and one decision', async () => {
    for (let i = 0; i < 5; i += 1) {
      await runSignalTick({
        now: new Date(NOW.getTime() + i * 60_000),
        agencyIds: [AGENCY],
        sweep: { deps: sweepDeps([overdueFact(77)]) },
      })
    }
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
    expect(await readCoverageDecisions(AGENCY, { subjectType: 'lead', subjectId: '77' })).toHaveLength(1)
  })

  it('rescheduling the follow-up produces new work on the next tick', async () => {
    await tick([overdueFact(77, 2)])
    const after = await tick([overdueFact(77, 9)])
    expect(after.sweep).toMatchObject({ enqueued: 1, duplicates: 0 })
    expect(await readSignalJobs(AGENCY)).toHaveLength(2)
  })
})

// ── K. overlapping invocations ───────────────────────────────────────────────

describe('K · overlapping cron invocations are safe', () => {
  it('two ticks running at once never process the same job twice', async () => {
    const facts = [overdueFact(1), overdueFact(2), overdueFact(3), overdueFact(4)]
    const [a, b] = await Promise.all([tick(facts), tick(facts)])

    // Enqueue collapses on the observation key; the drain partitions via SKIP LOCKED.
    expect(a.sweep.enqueued + b.sweep.enqueued).toBe(4)
    expect(a.worker.succeeded + b.worker.succeeded).toBe(4)
    expect(a.worker.failed + b.worker.failed).toBe(0)

    const jobs = await readSignalJobs(AGENCY)
    expect(jobs).toHaveLength(4)
    expect(jobs.every((j) => j.status === 'succeeded')).toBe(true)
    expect(jobs.every((j) => j.attempts === 1)).toBe(true) // claimed exactly once each
  })

  it('a job already leased by another worker is not claimed by a tick', async () => {
    await runSignalTick({ now: NOW, agencyIds: [AGENCY], sweep: { deps: sweepDeps([overdueFact(77)]) }, worker: { limit: 0 } })
    const leased = await claimSignalJobs('other-worker', 10)
    expect(leased).toHaveLength(1)

    const s = await tick([overdueFact(77)])
    expect(s.worker.claimed).toBe(0)
    expect(s.worker.decisions).toBe(0)
  })
})

// ── J. failure follows the Phase 2 rules, unchanged ──────────────────────────

describe('J · failure follows the existing retry and dead-letter rules', () => {
  it('a transient failure returns the job to the queue with backoff', async () => {
    const s = await tick([overdueFact(77)], [AGENCY], {
      reason: (async () => {
        throw new Error('world model down')
      }) as SignalWorkerDeps['reason'],
    })
    expect(s.worker).toMatchObject({ claimed: 1, failed: 1, succeeded: 0, decisions: 0 })

    const row = await db('signal_jobs').first()
    expect(row.status).toBe('pending')
    expect(row.lastError).toBe('world model down')
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('an invalid stored signal is dead-lettered, never retried forever', async () => {
    await runSignalTick({ now: NOW, agencyIds: [AGENCY], sweep: { deps: sweepDeps([overdueFact(77)]) }, worker: { limit: 0 } })
    await db('signal_jobs').update({ signal: db.raw(`signal - 'absence'`) })

    const s = await tick([overdueFact(77)])
    expect(s.worker).toMatchObject({ claimed: 1, deadLettered: 1, succeeded: 0, decisions: 0 })
    const row = await db('signal_jobs').first()
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('ingress-refused:missing_absence_marker')
  })

  it('a dead job is not picked up by later ticks', async () => {
    await runSignalTick({ now: NOW, agencyIds: [AGENCY], sweep: { deps: sweepDeps([overdueFact(77)]) }, worker: { limit: 0 } })
    await db('signal_jobs').update({ signal: db.raw(`signal - 'absence'`) })
    await tick([overdueFact(77)])

    const later = await tick([overdueFact(77)])
    expect(later.worker).toMatchObject({ claimed: 0, deadLettered: 0 })
  })
})

// ── bounded execution ────────────────────────────────────────────────────────

describe('bounded execution', () => {
  it('honours the per-invocation job cap and leaves the rest queued', async () => {
    const facts = [overdueFact(1), overdueFact(2), overdueFact(3)]
    const s = await runSignalTick({
      now: NOW,
      agencyIds: [AGENCY],
      sweep: { deps: sweepDeps(facts) },
      worker: { limit: 2, batchSize: 1 },
    })
    expect(s.sweep.enqueued).toBe(3)
    expect(s.worker.claimed).toBe(2)
    expect(s.worker.batches).toBe(2)
    expect(await readSignalJobs(AGENCY, { status: 'pending' })).toHaveLength(1)
  })

  it('stops on its time budget without stranding a lease it just took', async () => {
    const facts = [overdueFact(1), overdueFact(2), overdueFact(3)]
    const s = await runSignalTick({
      now: NOW,
      agencyIds: [AGENCY],
      sweep: { deps: sweepDeps(facts) },
      worker: { budgetMs: 0, batchSize: 1 },
    })
    expect(s.sweep.enqueued).toBe(3)
    expect(s.worker.budgetExhausted).toBe(true)
    expect(s.worker.claimed).toBe(0)
    // Nothing left leased: the budget gates claiming, never mid-batch abandonment.
    expect(await readSignalJobs(AGENCY, { status: 'leased' })).toHaveLength(0)
    expect(await readSignalJobs(AGENCY, { status: 'pending' })).toHaveLength(3)
  })

  it('the producer bound defers the rest to the next tick', async () => {
    const facts = [overdueFact(1), overdueFact(2), overdueFact(3)]
    const s = await runSignalTick({
      now: NOW,
      agencyIds: [AGENCY],
      sweep: { maxPerSweep: 1, deps: sweepDeps(facts) },
    })
    expect(s.sweep).toMatchObject({ detected: 3, enqueued: 1, deferred: 2 })
  })
})
