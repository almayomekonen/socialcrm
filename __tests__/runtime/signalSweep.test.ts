/**
 * The signal PRODUCER — integration test (real PostgreSQL).
 *
 * Phase 3 moved processing out of this module: it detects and enqueues, and the
 * worker drains. What is proven here against live `signal_jobs` is the producer
 * half of that contract — that a real detected observation lands exactly one
 * durable job, that repeated ticks are free, and that a rescheduled follow-up is
 * new work. The runtime half is __tests__/runtime/signalTick.test.ts.
 *
 * Runs under `test:runtime`.
 */
import { afterAll, beforeEach, describe, it, expect } from 'vitest'
import { db } from '@/config/db'
import { runSignalSweep } from '@/lib/ai/integration/signalSweep'
import { readSignalJobs } from '@/db/ai/signalJobs'
import { businessDayBounds } from '@/lib/today/time'
import type { SignalSweepDeps } from '@/lib/ai/integration/signalSweep'
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
const AGENCY = 9951

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

function factsDep(facts: LeadFact[]): SignalSweepDeps {
  return { listAgencyLeadFacts: (async (_s: Scope) => facts) as SignalSweepDeps['listAgencyLeadFacts'] }
}

describe('the producer — over the live queue', () => {
  it('a detected observation becomes exactly one durable job', async () => {
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: factsDep([overdueFact(77)]) })
    expect(s).toMatchObject({ agencies: 1, detected: 1, enqueued: 1, duplicates: 0, refused: 0, errored: 0 })

    const jobs = await readSignalJobs(AGENCY)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].expectation).toBe('followup.overdue')
    expect(jobs[0].subjectId).toBe('77')
    expect(jobs[0].signal.absence?.violatedExpectation).toBe('followup.overdue')
  })

  it('repeated ticks over an unchanged CRM create no further work', async () => {
    const deps = factsDep([overdueFact(77)])
    await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps })
    const second = await runSignalSweep({ now: new Date(NOW.getTime() + 60_000), agencyIds: [AGENCY], deps })
    const third = await runSignalSweep({ now: new Date(NOW.getTime() + 120_000), agencyIds: [AGENCY], deps })

    expect(second).toMatchObject({ detected: 1, enqueued: 0, duplicates: 1 })
    expect(third).toMatchObject({ detected: 1, enqueued: 0, duplicates: 1 })
    expect(await readSignalJobs(AGENCY)).toHaveLength(1)
  })

  it('rescheduling the follow-up is a new observation identity', async () => {
    await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: factsDep([overdueFact(77, 2)]) })
    const after = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: factsDep([overdueFact(77, 9)]) })

    expect(after).toMatchObject({ enqueued: 1, duplicates: 0 })
    const jobs = await readSignalJobs(AGENCY)
    expect(jobs).toHaveLength(2)
    expect(new Set(jobs.map((j) => j.observationKey)).size).toBe(2)
  })

  it('a terminal lead is excluded at the classifier, so nothing is enqueued', async () => {
    const closed = { ...overdueFact(77), status: 'closed' }
    const s = await runSignalSweep({ now: NOW, agencyIds: [AGENCY], deps: factsDep([closed]) })
    expect(s).toMatchObject({ agencies: 1, detected: 0, enqueued: 0 })
    expect(await readSignalJobs(AGENCY)).toHaveLength(0)
  })

  it('each agency gets its own job for the same subject', async () => {
    await runSignalSweep({ now: NOW, agencyIds: [9952, 9953], deps: factsDep([overdueFact(77)]) })
    expect(await readSignalJobs(9952)).toHaveLength(1)
    expect(await readSignalJobs(9953)).toHaveLength(1)
    expect(await readSignalJobs(9954)).toHaveLength(0)
  })
})
