/**
 * P0-8 regression — scheduling a no-response follow-up must never undo a send.
 *
 * Both schedulers run AFTER the customer-facing message has left and the
 * originating job is already marked complete (qualifyWorker, immediately after
 * `completeAutoResponseJob`). Before this guard they threw straight through the
 * worker, so a schema that rejects the job `reason` turned a SUCCESSFUL send
 * into a failed job — and invited the worker to retry a message the customer
 * had already received.
 *
 * The concrete trigger is a schema one: `auto_response_jobs.reason` only accepts
 * `no_response_warning`/`no_response_close` once migration 20260819120000 has
 * run, and that migration is deliberately held back pending production rollout
 * approval. Anywhere it has not run — the local development database included —
 * these inserts violate the CHECK.
 *
 * This test also pins the coexistence that the Wave 0 reconciliation had to get
 * right: the guard sits on top of main's contact-job version of this module,
 * whose `isPositiveLeadId` checks must survive untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enqueueError: null as Error | null,
  enqueueCalls: [] as Record<string, unknown>[],
}))

vi.mock('@/config/db', () => ({
  db: Object.assign(() => ({}), {
    transaction: async (fn: (trx: unknown) => unknown) => fn({}),
    raw: () => ({}),
  }),
}))

vi.mock('@/db/autoResponseJobs', () => ({
  enqueueAutoResponse: async (_trx: unknown, args: Record<string, unknown>) => {
    h.enqueueCalls.push(args)
    if (h.enqueueError) throw h.enqueueError
    return 4242
  },
  skipPendingNoResponseJobs: async () => {},
  claimAutoResponseJobs: async () => [],
  completeAutoResponseJob: async () => {},
  skipAutoResponseJob: async () => {},
  failAutoResponseJob: async () => {},
  countSentToday: async () => 0,
  hasSentFirstContact: async () => false,
  reclaimStaleAutoResponseJobs: async () => 0,
}))

const ARGS = { agencyId: 103, conversationId: 77, leadId: 5, channel: 'whatsapp', triggerSequence: 9 }

beforeEach(() => {
  h.enqueueError = null
  h.enqueueCalls = []
})

describe('scheduleNoResponseWarning / Close — never throw', () => {
  it('returns the job id on the happy path', async () => {
    const m = await import('@/lib/inbox/autoresponse/processNoResponseJob')
    expect(await m.scheduleNoResponseWarning(ARGS)).toBe(4242)
    expect(h.enqueueCalls[0]).toMatchObject({ reason: 'no_response_warning' })
  })

  it('SWALLOWS a CHECK-constraint violation instead of failing the completed send', async () => {
    // Exactly what an unapplied 20260819120000 produces.
    h.enqueueError = new Error(
      'new row for relation "auto_response_jobs" violates check constraint "auto_response_jobs_reason_check"',
    )
    const m = await import('@/lib/inbox/autoresponse/processNoResponseJob')

    await expect(m.scheduleNoResponseWarning(ARGS)).resolves.toBeNull()
    await expect(m.scheduleNoResponseClose(ARGS)).resolves.toBeNull()
  })

  it('swallows any enqueue failure, not just the schema one', async () => {
    h.enqueueError = new Error('connection terminated unexpectedly')
    const m = await import('@/lib/inbox/autoresponse/processNoResponseJob')
    await expect(m.scheduleNoResponseClose(ARGS)).resolves.toBeNull()
  })

  it('still refuses an invalid trigger sequence without touching the queue', async () => {
    const m = await import('@/lib/inbox/autoresponse/processNoResponseJob')
    for (const bad of [0, -1, null, undefined, NaN]) {
      expect(await m.scheduleNoResponseWarning({ ...ARGS, triggerSequence: bad as number })).toBeNull()
    }
    expect(h.enqueueCalls).toHaveLength(0)
  })

  it('passes the correct reason and delay through for each scheduler', async () => {
    const m = await import('@/lib/inbox/autoresponse/processNoResponseJob')
    await m.scheduleNoResponseWarning(ARGS)
    await m.scheduleNoResponseClose(ARGS)

    expect(h.enqueueCalls.map((c) => c.reason)).toEqual(['no_response_warning', 'no_response_close'])
    // Distinct, non-zero delays — the close must never fire with the warning.
    expect(h.enqueueCalls[0].delaySeconds).not.toBe(h.enqueueCalls[1].delaySeconds)
  })
})
