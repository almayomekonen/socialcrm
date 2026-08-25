/**
 * Phase-2 durable substrate — integration tests (real PostgreSQL).
 *
 * A queue's guarantees are storage guarantees; asserting them against a mock
 * proves nothing. Every test here runs against live `signal_jobs`: the unique
 * index, the tenant CHECK, `FOR UPDATE SKIP LOCKED` under two real concurrent
 * transactions, lease expiry, backoff, and the dead-letter boundary.
 *
 * Runs under `test:runtime`.
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import {
  enqueueSignal,
  enqueueSignals,
  claimSignalJobs,
  succeedSignalJob,
  failSignalJob,
  deadLetterSignalJob,
  reclaimStaleSignalJobs,
  readSignalJobs,
} from '@/db/ai/signalJobs'
import { observationKeyFor } from '@/lib/ai/integration/observationKey'
import { runSignalWorker, type SignalWorkerDeps } from '@/lib/ai/integration/signalWorker'
import { readCoverageDecisions } from '@/db/ai/shadowCoverage'
import { detectFollowupOverdue } from '@/lib/ai/integration/detectors/followupOverdue'
import { reason as realReason } from '@/lib/ai/runtime/reasoning'
import { businessDayBounds } from '@/lib/today/time'
import type { CognitionRequest } from '@/lib/ai/runtime/scheduler'
import type { RelationshipWorldModel } from '@/lib/ai/runtime/worldModel'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import type { LeadFact } from '@/lib/today/types'
import type { Scope } from '@/db/ai/stateManagement'

afterAll(async () => {
  await db.destroy()
})

beforeEach(async () => {
  await db('signal_jobs').del()
})

const NOW = new Date('2026-08-25T09:00:00.000Z')
const ctx = businessDayBounds(NOW.getTime())
const DAY = 86_400_000
const AGENCY = 9941

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

/** A real detector signal — the queue is only ever fed by the ratified contract. */
function signalFor(leadId: number, agencyId = AGENCY, daysOverdue = 2): ExternalSignal {
  const [signal] = detectFollowupOverdue([overdueFact(leadId, daysOverdue)], ctx, { agencyId })
  return signal
}

function emptyModel(scope: Scope, subjectId: string): RelationshipWorldModel {
  return {
    scope,
    subject: { subjectType: 'lead', subjectId },
    beliefs: [],
    beliefsByKey: {},
    narrative: [],
    narrativeByKind: {} as RelationshipWorldModel['narrativeByKind'],
    asOf: NOW.toISOString(),
    isEmpty: true,
  }
}

// ── A. enqueue creates one deterministic job ─────────────────────────────────

describe('A · enqueue creates one deterministic job', () => {
  it('stores the signal verbatim under a key derived from the observation', async () => {
    const signal = signalFor(77)
    const res = await enqueueSignal(signal)
    expect(res.enqueued).toBe(true)
    if (res.enqueued !== true) return

    const rows = await readSignalJobs(AGENCY)
    expect(rows).toHaveLength(1)
    const [job] = rows
    expect(job.agencyId).toBe(AGENCY)
    expect(job.observationKey).toBe(observationKeyFor(signal))
    expect(job.observationKey).toBe(`followup.overdue:lead:77:at:${signal.absence!.expectedBy}`)
    expect(job.expectation).toBe('followup.overdue')
    expect(job.subjectType).toBe('lead')
    expect(job.subjectId).toBe('77')
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(job.detectedAt).toBe(NOW.toISOString())
    // Enough provenance to reconstruct the exact ingress input.
    expect(job.signal.signalType).toBe('absence')
    expect(job.signal.absence).toEqual(signal.absence)
    expect(job.signal.traceRefs).toEqual([{ type: 'lead', id: '77' }])
    expect(job.signal.source).toEqual({ kind: 'system', id: 'detector:followup.overdue' })
  })

  it('the key is a pure function of the observation — never of the clock', async () => {
    const s1 = signalFor(77)
    const s2 = { ...signalFor(77), occurredAt: new Date(NOW.getTime() + 6 * 3_600_000).toISOString() }
    expect(observationKeyFor(s2)).toBe(observationKeyFor(s1))
  })

  it('a rescheduled follow-up is a NEW observation', async () => {
    await enqueueSignal(signalFor(77, AGENCY, 2))
    const later = await enqueueSignal(signalFor(77, AGENCY, 9)) // different expectedBy
    expect(later.enqueued).toBe(true)
    expect(await readSignalJobs(AGENCY)).toHaveLength(2)
  })
})

// ── B. duplicate signal cannot create duplicate active work ──────────────────

describe('B · duplicates cannot create duplicate work', () => {
  it('re-detecting the same observation is a no-op, not a second job', async () => {
    const signal = signalFor(77)
    const first = await enqueueSignal(signal)
    const second = await enqueueSignal(signal)
    const third = await enqueueSignal({ ...signal, occurredAt: new Date(NOW.getTime() + 60_000).toISOString() })

    expect(first.enqueued).toBe(true)
    expect(second).toMatchObject({ enqueued: false, reason: 'duplicate' })
    expect(third).toMatchObject({ enqueued: false, reason: 'duplicate' })
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
  })

  it('a processed observation is not re-enqueued by a later sweep', async () => {
    const signal = signalFor(77)
    await enqueueSignal(signal)
    const [job] = await claimSignalJobs('w1', 10)
    await succeedSignalJob(job.id)

    expect(await enqueueSignal(signal)).toMatchObject({ enqueued: false, reason: 'duplicate' })
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
  })

  it('a batch of the same observation yields exactly one job', async () => {
    const signal = signalFor(77)
    const results = await enqueueSignals([signal, signal, signal])
    expect(results.filter((r) => r.enqueued).length).toBe(1)
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
  })
})

// ── C. concurrent workers cannot lease the same job ──────────────────────────

describe('C · concurrent workers cannot lease the same job', () => {
  it('SKIP LOCKED: a row another transaction holds is skipped, never waited on', async () => {
    await enqueueSignal(signalFor(1))
    await enqueueSignal(signalFor(2))
    const all = await readSignalJobs(AGENCY)
    const held = all[0]

    // Worker A holds a real row lock in an open transaction.
    const trxA = await db.transaction()
    await trxA.raw('SELECT id FROM signal_jobs WHERE id = ? FOR UPDATE', [held.id])

    try {
      // Worker B, on a different connection, with a short lock timeout: WITHOUT
      // SKIP LOCKED this blocks on A's row and dies of lock_timeout instead.
      const claimed = await db.transaction(async (trxB) => {
        await trxB.raw(`SET LOCAL lock_timeout = '750ms'`)
        return claimSignalJobs('worker-b', 10, trxB)
      })
      expect(claimed.map((j) => j.id)).toEqual([all[1].id])
      expect(claimed.map((j) => j.id)).not.toContain(held.id)
    } finally {
      await trxA.rollback()
    }
  })

  it('two concurrent drains partition the queue — no job is leased twice', async () => {
    await enqueueSignals([signalFor(1), signalFor(2), signalFor(3), signalFor(4), signalFor(5)])

    const [a, b] = await Promise.all([claimSignalJobs('worker-a', 5), claimSignalJobs('worker-b', 5)])
    const ids = [...a, ...b].map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length) // no overlap
    expect(ids).toHaveLength(5)
    expect(await readSignalJobs(AGENCY, { status: 'pending' })).toHaveLength(0)
  })

  it('a leased job is not claimable again', async () => {
    await enqueueSignal(signalFor(77))
    expect(await claimSignalJobs('w1', 10)).toHaveLength(1)
    expect(await claimSignalJobs('w2', 10)).toHaveLength(0)
  })
})

// ── D. expired lease becomes reclaimable ─────────────────────────────────────

describe('D · lease expiry', () => {
  it('a lease held past its lifetime is reclaimed and becomes claimable again', async () => {
    await enqueueSignal(signalFor(77))
    const [job] = await claimSignalJobs('crashed-worker', 10)
    await db('signal_jobs')
      .where({ id: job.id })
      .update({ lockedAt: new Date(Date.now() - 10 * 60_000) })

    expect(await reclaimStaleSignalJobs(5 * 60_000)).toBe(1)

    const [reclaimed] = await readSignalJobs(AGENCY)
    expect(reclaimed.status).toBe('pending')
    const [again] = await claimSignalJobs('healthy-worker', 10)
    expect(again.id).toBe(job.id)
    expect(again.attempts).toBe(2) // the crash consumed one; a crash loop cannot run forever
  })

  it('a live lease is left alone', async () => {
    await enqueueSignal(signalFor(77))
    await claimSignalJobs('w1', 10)
    expect(await reclaimStaleSignalJobs(5 * 60_000)).toBe(0)
    expect((await readSignalJobs(AGENCY))[0].status).toBe('leased')
  })

  it('reclaiming a job with no attempts left dead-letters it rather than cycling', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 1 })
    const [job] = await claimSignalJobs('crashed-worker', 10)
    await db('signal_jobs')
      .where({ id: job.id })
      .update({ lockedAt: new Date(Date.now() - 10 * 60_000) })

    await reclaimStaleSignalJobs(5 * 60_000)
    expect((await readSignalJobs(AGENCY))[0].status).toBe('dead')
  })
})

// ── E / F / G / H. terminal lifecycle and attempts ───────────────────────────

describe('E · successful processing marks the job complete', () => {
  it('succeed only applies while the job is still leased', async () => {
    await enqueueSignal(signalFor(77))
    const [job] = await claimSignalJobs('w1', 10)

    expect(await succeedSignalJob(job.id)).toBe(true)
    const [done] = await readSignalJobs(AGENCY)
    expect(done.status).toBe('succeeded')
    const row = await db('signal_jobs').where({ id: job.id }).first()
    expect(row.completedAt).not.toBeNull()
    expect(row.lockedAt).toBeNull()
    expect(row.lockedBy).toBeNull()

    // A second completion (e.g. after a reclaim) cannot re-write it.
    expect(await succeedSignalJob(job.id)).toBe(false)
  })

  it('a succeeded job is never claimed again', async () => {
    await enqueueSignal(signalFor(77))
    const [job] = await claimSignalJobs('w1', 10)
    await succeedSignalJob(job.id)
    expect(await claimSignalJobs('w2', 10)).toHaveLength(0)
  })
})

describe('F · retryable failure schedules a retry with backoff', () => {
  it('returns the job to pending behind a growing delay', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 5 })
    const [job] = await claimSignalJobs('w1', 10)
    await failSignalJob(job.id, 'db blip')

    const first = await db('signal_jobs').where({ id: job.id }).first()
    expect(first.status).toBe('pending')
    expect(first.lastError).toBe('db blip')
    expect(first.lockedAt).toBeNull()
    expect(new Date(first.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())
    const firstDelay = new Date(first.nextAttemptAt).getTime() - Date.now()

    // Make it due, claim again, fail again — the delay must grow.
    await db('signal_jobs')
      .where({ id: job.id })
      .update({ nextAttemptAt: new Date(Date.now() - 1000) })
    const [again] = await claimSignalJobs('w1', 10)
    await failSignalJob(again.id, 'db blip 2')
    const second = await db('signal_jobs').where({ id: job.id }).first()
    const secondDelay = new Date(second.nextAttemptAt).getTime() - Date.now()
    expect(secondDelay).toBeGreaterThan(firstDelay)
  })

  it('a job is not claimable before its next attempt is due', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 5 })
    const [job] = await claimSignalJobs('w1', 10)
    await failSignalJob(job.id, 'not yet')
    expect(await claimSignalJobs('w2', 10)).toHaveLength(0)
  })
})

describe('G · terminal failure stops retries', () => {
  it('dead-letters once the attempts budget is spent', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 2 })

    const [a] = await claimSignalJobs('w1', 10)
    expect(a.attempts).toBe(1)
    await failSignalJob(a.id, 'boom 1')
    await db('signal_jobs')
      .where({ id: a.id })
      .update({ nextAttemptAt: new Date(Date.now() - 1000) })

    const [b] = await claimSignalJobs('w1', 10)
    expect(b.attempts).toBe(2)
    await failSignalJob(b.id, 'boom 2')

    const row = await db('signal_jobs').where({ id: a.id }).first()
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('boom 2')
    await db('signal_jobs')
      .where({ id: a.id })
      .update({ nextAttemptAt: new Date(Date.now() - 1000) })
    expect(await claimSignalJobs('w1', 10)).toHaveLength(0)
  })

  it('an immediate dead-letter ignores the attempt counter entirely', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 99 })
    const [job] = await claimSignalJobs('w1', 10)
    await deadLetterSignalJob(job.id, 'ingress-refused:missing_absence_marker')

    const row = await db('signal_jobs').where({ id: job.id }).first()
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(1)
    expect(await claimSignalJobs('w1', 10)).toHaveLength(0)
  })
})

describe('H · attempt count is correct', () => {
  it('increments once per claim and never on enqueue', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 9 })
    expect((await readSignalJobs(AGENCY))[0].attempts).toBe(0)

    for (const expected of [1, 2, 3]) {
      const [job] = await claimSignalJobs('w1', 10)
      expect(job.attempts).toBe(expected)
      await failSignalJob(job.id, 'retry')
      await db('signal_jobs')
        .where({ id: job.id })
        .update({ nextAttemptAt: new Date(Date.now() - 1000) })
    }
    expect((await readSignalJobs(AGENCY))[0].attempts).toBe(3)
  })
})

// ── I. agency identity cannot cross ──────────────────────────────────────────

describe('I · agency identity cannot cross', () => {
  it('the agency comes from the signal scope; reads are filtered by it', async () => {
    await enqueueSignal(signalFor(77, 9942))
    await enqueueSignal(signalFor(77, 9943))

    const a = await readSignalJobs(9942)
    const b = await readSignalJobs(9943)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].agencyId).toBe(9942)
    expect(b[0].agencyId).toBe(9943)
    expect(a[0].signal.scope).toEqual({ agencyId: 9942 })
    expect(await readSignalJobs(9944)).toHaveLength(0)
  })

  it('the same observation in two agencies is two independent jobs', async () => {
    const key = observationKeyFor(signalFor(77, 9942))
    await enqueueSignal(signalFor(77, 9942))
    await enqueueSignal(signalFor(77, 9943))
    expect(await readSignalJobs(9942, { observationKey: key })).toHaveLength(1)
    expect(await readSignalJobs(9943, { observationKey: key })).toHaveLength(1)
  })

  it('storage refuses a row whose column and payload disagree about the tenant', async () => {
    const signal = signalFor(77, 9942)
    await expect(
      db('signal_jobs').insert({
        agencyId: 9999, // forged
        observationKey: 'forged',
        expectation: 'followup.overdue',
        subjectType: 'lead',
        subjectId: '77',
        signal: JSON.stringify(signal), // still says 9942
        detectedAt: NOW,
      }),
    ).rejects.toThrow(/signal_jobs_agency_matches_signal/)
  })

  it('storage refuses a signal carrying no scope at all', async () => {
    await expect(
      db('signal_jobs').insert({
        agencyId: 9942,
        observationKey: 'scopeless',
        expectation: 'followup.overdue',
        subjectType: 'lead',
        subjectId: '77',
        signal: JSON.stringify({ signalType: 'absence' }),
        detectedAt: NOW,
      }),
    ).rejects.toThrow(/signal_jobs_agency_matches_signal/)
  })
})

// ── J. malformed / invalid signals cannot enter the queue ────────────────────

describe('J · malformed signals cannot enter the queue', () => {
  it('the ratified ingress refuses it at the door, and nothing is stored', async () => {
    const res = await enqueueSignal({ ...signalFor(77), absence: undefined })
    expect(res).toMatchObject({ enqueued: false, reason: 'rejected', detail: 'missing_absence_marker' })
    expect(await readSignalJobs(AGENCY)).toHaveLength(0)
  })

  it.each([
    ['no scope', { scope: undefined }],
    ['a non-positive agency', { scope: { agencyId: 0 } }],
    ['an invalid time', { occurredAt: 'not-a-time' }],
    ['an unknown source', { source: { kind: 'oracle' } }],
  ])('refuses a signal with %s', async (_label, over) => {
    const res = await enqueueSignal({ ...signalFor(77), ...(over as Partial<ExternalSignal>) })
    expect(res.enqueued).toBe(false)
    expect(await db('signal_jobs').count<{ count: string }[]>('id as count')).toEqual([{ count: '0' }])
  })

  it('refuses a signal that names no subject — it could not be identified', async () => {
    const res = await enqueueSignal({ ...signalFor(77), subject: undefined })
    expect(res).toMatchObject({ enqueued: false, reason: 'unidentifiable' })
    expect(await readSignalJobs(AGENCY)).toHaveLength(0)
  })
})

// ── K. queue processing invokes the existing RuntimeScheduler path ───────────

describe('K · the worker drains through the ratified runtime', () => {
  function workerDeps(requests: CognitionRequest[]): SignalWorkerDeps {
    return {
      reason: ((request: CognitionRequest, opts: Parameters<typeof realReason>[1] = {}) => {
        requests.push(request)
        return realReason(request, {
          ...opts,
          deps: { hydrateRelationship: async (s: Scope, id: string) => emptyModel(s, id) },
        })
      }) as SignalWorkerDeps['reason'],
    }
  }

  it('claims, admits via RuntimeScheduler, reasons, decides and records', async () => {
    await enqueueSignal(signalFor(77))
    const requests: CognitionRequest[] = []
    const s = await runSignalWorker({ now: NOW, deps: workerDeps(requests) })

    expect(s).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, deadLettered: 0, decisions: 1, unrepresentable: 0 })

    // Fields only RuntimeScheduler.admit() sets — the trigger kind comes from M3.
    expect(requests).toHaveLength(1)
    expect(requests[0].tier).toBe(2)
    expect(requests[0].reason).toBe('absence')
    expect(requests[0].trigger).toEqual({ kind: 'absence_detected', asOfTime: NOW.toISOString() })
    expect(requests[0].scope).toEqual({ agencyId: AGENCY })

    const rows = await readCoverageDecisions(AGENCY, { subjectType: 'lead', subjectId: '77' })
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('absence')
    expect(rows[0].outcome).toBe('stay_silent')

    expect((await readSignalJobs(AGENCY))[0].status).toBe('succeeded')
  })

  it('drains several agencies in one pass, each under its own scope', async () => {
    await enqueueSignal(signalFor(77, 9942))
    await enqueueSignal(signalFor(88, 9943))
    const requests: CognitionRequest[] = []
    const s = await runSignalWorker({ now: NOW, deps: workerDeps(requests) })

    expect(s.claimed).toBe(2)
    expect(s.succeeded).toBe(2)
    expect(requests.map((r) => r.scope.agencyId).sort()).toEqual([9942, 9943])
    expect(await readCoverageDecisions(9942, { subjectType: 'lead', subjectId: '77' })).toHaveLength(1)
    expect(await readCoverageDecisions(9943, { subjectType: 'lead', subjectId: '88' })).toHaveLength(1)
  })

  it('a stored signal the ingress now refuses is dead-lettered, not retried', async () => {
    await enqueueSignal(signalFor(77))
    // Corrupt the row after it was accepted — the worker re-runs M3 on read-back.
    await db('signal_jobs').update({ signal: JSON.stringify({ ...signalFor(77), absence: undefined }) })

    const s = await runSignalWorker({ now: NOW, deps: workerDeps([]) })
    expect(s).toMatchObject({ claimed: 1, deadLettered: 1, succeeded: 0, decisions: 0 })
    const row = await db('signal_jobs').first()
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('ingress-refused:missing_absence_marker')
  })

  it('a transient failure returns the job to the queue with backoff', async () => {
    await enqueueSignal(signalFor(77), { maxAttempts: 5 })
    const s = await runSignalWorker({
      now: NOW,
      deps: {
        reason: (async () => {
          throw new Error('world model down')
        }) as SignalWorkerDeps['reason'],
      },
    })
    expect(s).toMatchObject({ claimed: 1, failed: 1, succeeded: 0, decisions: 0 })
    const row = await db('signal_jobs').first()
    expect(row.status).toBe('pending')
    expect(row.lastError).toBe('world model down')
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('an empty queue is a clean no-op', async () => {
    const s = await runSignalWorker({ now: NOW })
    expect(s).toMatchObject({ claimed: 0, succeeded: 0, failed: 0, decisions: 0 })
  })

  it('the kill switch halts the drain without touching the queue', async () => {
    await enqueueSignal(signalFor(77))
    process.env.SIGNAL_WORKER_KILL = '1'
    try {
      const s = await runSignalWorker({ now: NOW })
      expect(s).toMatchObject({ claimed: 0, succeeded: 0, decisions: 0 })
      expect((await readSignalJobs(AGENCY))[0].status).toBe('pending')
    } finally {
      delete process.env.SIGNAL_WORKER_KILL
    }
  })
})
