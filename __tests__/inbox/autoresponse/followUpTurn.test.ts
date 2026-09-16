import { describe, expect, it } from 'vitest'
import { decideFollowUpTurn, NON_RESUMABLE_SKIP_REASONS } from '@/lib/inbox/autoresponse/followUpTurn'

/**
 * V11 — a message that arrives while a turn is running must still be answered.
 *
 * THE GAP THIS LOCKS. The in-flight unique index allows one pending/processing
 * job per conversation, which is what collapses several rapid messages into one
 * reply. But the worker reads its transcript once. A message landing after that
 * read is refused by the index and covered by no job, and the minute-ly cron only
 * claims jobs that already exist — so it was never answered at all.
 *
 * These are the decision rules. The wiring is exercised end-to-end against the
 * real database in followUpTurn.db.test.ts.
 */
const base = {
  coveredSequence: 5,
  outcome: 'sent' as const,
  jobReason: 'qualify_turn' as const,
}

describe('decideFollowUpTurn', () => {
  it('enqueues when a newer inbound arrived while the turn was running', () => {
    const d = decideFollowUpTurn({ ...base, latestInbound: { sequence: 6 } })
    expect(d).toEqual({ enqueue: true, triggerSequence: 6 })
  })

  it('does nothing when the turn already covered the newest message', () => {
    const d = decideFollowUpTurn({ ...base, latestInbound: { sequence: 5 } })
    expect(d).toEqual({ enqueue: false, reason: 'already_covered' })
  })

  it('does nothing when every inbound is older than what this turn covered', () => {
    const d = decideFollowUpTurn({ ...base, latestInbound: { sequence: 4 } })
    expect(d).toEqual({ enqueue: false, reason: 'already_covered' })
  })

  it('fires even when our reply sits at a HIGHER sequence than the dropped message', () => {
    // The real shape of the bug: inbound(1), inbound(2), our reply(3).
    // The newest MESSAGE is outbound; the newest INBOUND is still unanswered.
    const d = decideFollowUpTurn({ ...base, coveredSequence: 1, latestInbound: { sequence: 2 } })
    expect(d).toEqual({ enqueue: true, triggerSequence: 2 })
  })

  it('TERMINATES — after the follow-up covers the message, nothing more is owed', () => {
    // Turn covers 5, message 6 lands → follow-up for 6.
    const first = decideFollowUpTurn({ ...base, latestInbound: { sequence: 6 } })
    expect(first).toHaveProperty('triggerSequence', 6)
    // That follow-up settles having covered 6, and no newer message exists.
    const second = decideFollowUpTurn({ ...base, coveredSequence: 6, latestInbound: { sequence: 6 } })
    expect(second).toEqual({ enqueue: false, reason: 'already_covered' })
  })

  it('handles an empty or malformed conversation without enqueuing', () => {
    expect(decideFollowUpTurn({ ...base, latestInbound: null })).toEqual({ enqueue: false, reason: 'no_inbound' })
    expect(decideFollowUpTurn({ ...base, latestInbound: undefined })).toEqual({ enqueue: false, reason: 'no_inbound' })
    expect(
      decideFollowUpTurn({ ...base, latestInbound: { sequence: Number.NaN } }),
    ).toEqual({ enqueue: false, reason: 'bad_sequence' })
  })
})

describe('a finished conversation is never re-opened by a follow-up', () => {
  for (const skipReason of [...NON_RESUMABLE_SKIP_REASONS]) {
    it(`no follow-up after ${skipReason}`, () => {
      const d = decideFollowUpTurn({
        ...base,
        outcome: 'skipped',
        skipReason,
        latestInbound: { sequence: 9 },
      })
      expect(d).toEqual({ enqueue: false, reason: `terminal_${skipReason}` })
    })
  }

  it('opt-out and human takeover are both covered', () => {
    expect(NON_RESUMABLE_SKIP_REASONS.has('opt_out')).toBe(true)
    expect(NON_RESUMABLE_SKIP_REASONS.has('opted_out')).toBe(true)
    expect(NON_RESUMABLE_SKIP_REASONS.has('human_active')).toBe(true)
  })

  it('DOES follow up after a transient skip — a rep who started typing then stopped', () => {
    const d = decideFollowUpTurn({
      ...base,
      outcome: 'skipped',
      skipReason: 'human_typing',
      latestInbound: { sequence: 9 },
    })
    expect(d).toEqual({ enqueue: true, triggerSequence: 9 })
  })
})

describe('a job that will retry is left alone', () => {
  for (const outcome of ['failed', 'error'] as const) {
    it(`${outcome} → the existing attempts/lease machinery covers it`, () => {
      const d = decideFollowUpTurn({ ...base, outcome, latestInbound: { sequence: 9 } })
      expect(d).toEqual({ enqueue: false, reason: 'job_will_retry' })
    })
  }
})

describe('only real turn jobs spawn a follow-up', () => {
  for (const jobReason of ['no_response_warning', 'no_response_close'] as const) {
    it(`${jobReason} does not`, () => {
      const d = decideFollowUpTurn({ ...base, jobReason, latestInbound: { sequence: 9 } })
      expect(d).toEqual({ enqueue: false, reason: 'not_a_turn_job' })
    })
  }

  it('first_contact does — its own single-job guard then decides whether it lands', () => {
    const d = decideFollowUpTurn({
      ...base,
      jobReason: 'first_contact',
      latestInbound: { sequence: 9 },
    })
    expect(d).toEqual({ enqueue: true, triggerSequence: 9 })
  })
})
