/**
 * Late Meta CANCEL attribution (lib/connections/lateCancelDetail.ts): a CANCEL
 * that arrives after our attempt ended is attached to that attempt once, and
 * never to a live, newer, successful or long-finished attempt.
 */
import { describe, expect, it } from 'vitest'
import { cancelIds, createLateCancelTracker, LATE_CANCEL_WINDOW_MS, CONNECT_ATTEMPT_ID, newConnectAttemptId } from '@/lib/connections/lateCancelDetail'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}
const failed = { failed: true, known: {} }
const C = { errorReported: false, step: 'PHONE_NUMBER_SETUP' as const, sessionId: 'sess_ABC-123' }

describe('createLateCancelTracker', () => {
  it('attributes a CANCEL after a failed attempt ended to that attempt, once', () => {
    const c = clock()
    const t = createLateCancelTracker(c.now)
    t.begin('attempt-a1')
    t.end('attempt-a1', failed)
    c.advance(5_000)
    expect(t.late(C)).toEqual({ attemptId: 'attempt-a1', detail: { step: 'PHONE_NUMBER_SETUP', metaSessionId: 'sess_ABC-123' } })
    expect(t.late({ ...C, sessionId: 'sess_OTHER' })).toBeNull()
  })

  it('returns null while the attempt is live: the gate owns that CANCEL', () => {
    const t = createLateCancelTracker(clock().now)
    t.begin('attempt-a1')
    expect(t.late(C)).toBeNull()
  })

  it('returns null with no attempt at all', () => {
    expect(createLateCancelTracker(clock().now).late(C)).toBeNull()
  })

  it('never attaches late detail to a successful attempt', () => {
    const t = createLateCancelTracker(clock().now)
    t.begin('attempt-a1')
    t.end('attempt-a1', { failed: false, known: {} })
    expect(t.late(C)).toBeNull()
  })

  it('stops attributing after the window', () => {
    const c = clock()
    const t = createLateCancelTracker(c.now)
    t.begin('attempt-a1')
    t.end('attempt-a1', failed)
    c.advance(LATE_CANCEL_WINDOW_MS + 1)
    expect(t.late(C)).toBeNull()
  })

  it('a newer attempt closes the older one: its late CANCEL is never misattributed', () => {
    const t = createLateCancelTracker(clock().now)
    t.begin('attempt-a1')
    t.end('attempt-a1', failed)
    t.begin('attempt-b2') // live
    expect(t.late(C)).toBeNull()
    // The older attempt settling now (out of order) changes nothing.
    t.end('attempt-a1', failed)
    expect(t.late(C)).toBeNull()
    // Once the newer one fails, a CANCEL belongs to it, not to the older one.
    t.end('attempt-b2', failed)
    expect(t.late(C)?.attemptId).toBe('attempt-b2')
  })

  it('an end for an attempt that already ended is ignored', () => {
    const c = clock()
    const t = createLateCancelTracker(c.now)
    t.begin('attempt-a1')
    t.end('attempt-a1', failed)
    c.advance(LATE_CANCEL_WINDOW_MS - 10)
    t.end('attempt-a1', failed) // must not restart the window
    c.advance(20)
    expect(t.late(C)).toBeNull()
  })

  it('sends only ids the failure event did not already carry, and nothing when there are none', () => {
    const t = createLateCancelTracker(clock().now)
    t.begin('attempt-a1')
    t.end('attempt-a1', { failed: true, known: { step: 'PHONE_NUMBER_SETUP' } })
    expect(t.late({ errorReported: false, step: 'PHONE_NUMBER_SETUP' })).toBeNull()
    expect(t.late({ errorReported: false })).toBeNull()
    expect(t.late({ ...C, errorId: '4242' })).toEqual({ attemptId: 'attempt-a1', detail: { metaErrorId: '4242', metaSessionId: 'sess_ABC-123' } })
  })
})

describe('cancelIds', () => {
  it('keeps ids only, never Meta text', () => {
    expect(cancelIds({ errorReported: true, errorMessage: 'number 0501234567 cannot be shared', errorId: '7', sessionId: 's1' })).toEqual({ metaErrorId: '7', metaSessionId: 's1' })
    expect(cancelIds(undefined)).toEqual({})
  })
})

describe('newConnectAttemptId', () => {
  it('is unique and accepted by the server pattern', () => {
    const a = newConnectAttemptId()
    expect(a).not.toBe(newConnectAttemptId())
    expect(CONNECT_ATTEMPT_ID.test(a)).toBe(true)
  })
})
