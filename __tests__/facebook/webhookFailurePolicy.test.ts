/**
 * P0-4 — the recovery policy for failed Meta lead ingestion.
 *
 * Both webhooks answer 200 unconditionally, so Meta never redelivers and this
 * policy is the only thing standing between a transient Graph error and a
 * permanently lost paid lead. Two failure modes matter equally and pull in
 * opposite directions:
 *
 *   giving up too early  → the customer loses a lead they paid for
 *   never giving up      → a retry loop hammers Meta with requests that cannot
 *                          succeed, against an app whose webhook subscription is
 *                          load-bearing for every customer
 *
 * Every case below pins one of those two edges.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_ATTEMPTS,
  backoffSeconds,
  decideAfterAttempt,
  isRetryableFailure,
  shouldAlertOnTerminal,
} from '@/lib/facebook/webhookFailurePolicy'

describe('isRetryableFailure', () => {
  it('retries every transient cause', () => {
    for (const t of ['timeout', 'fetch_error', 'graph_api_error', 'db_error', 'unhandled_error']) {
      expect(isRetryableFailure(t)).toBe(true)
    }
  })

  it('never retries a dead token', () => {
    // A 401 cannot be fixed by repetition — only the customer reconnecting fixes
    // it, and retrying is exactly the "hammering Meta" this queue must avoid.
    expect(isRetryableFailure('token_expired')).toBe(false)
  })
})

describe('backoffSeconds — long, coarse, bounded', () => {
  it('escalates and then holds at the ceiling', () => {
    expect(backoffSeconds(0)).toBe(300)
    expect(backoffSeconds(1)).toBe(900)
    expect(backoffSeconds(2)).toBe(2_700)
    expect(backoffSeconds(3)).toBe(7_200)
    expect(backoffSeconds(4)).toBe(21_600)
    // Held, never unbounded and never zero.
    expect(backoffSeconds(99)).toBe(21_600)
  })

  it('never returns a tight interval for a malformed count', () => {
    for (const bad of [-5, NaN, Infinity]) {
      expect(backoffSeconds(bad as number)).toBeGreaterThanOrEqual(300)
    }
  })
})

describe('decideAfterAttempt', () => {
  it('transient failure → retry, with the attempt count advanced exactly once', () => {
    const d = decideAfterAttempt({ kind: 'transient', error: 'HTTP 500' }, 0)
    expect(d).toEqual({ status: 'pending', attempts: 1, retryInSeconds: 900 })
  })

  it('repeated transient failure eventually goes terminal, not forever', () => {
    // Walk the whole budget the way the worker does.
    let attempts = 0
    const seen: string[] = []
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
      const d = decideAfterAttempt({ kind: 'transient', error: 'HTTP 500' }, attempts)
      seen.push(d.status)
      if (d.status !== 'pending') break
      attempts = d.attempts
    }
    expect(seen[seen.length - 1]).toBe('dead')
    expect(seen.filter((s) => s === 'pending').length).toBe(MAX_ATTEMPTS - 1)
  })

  it('records WHY it gave up', () => {
    const d = decideAfterAttempt({ kind: 'transient', error: 'x' }, MAX_ATTEMPTS - 1)
    expect(d).toEqual({ status: 'dead', resolution: 'max_attempts' })
  })

  it('a recovered lead resolves the row', () => {
    expect(decideAfterAttempt({ kind: 'recovered' }, 2)).toEqual({
      status: 'resolved',
      resolution: 'recovered',
    })
  })

  it('a lead that already exists resolves the row — a redelivery winning is success', () => {
    // This is the idempotency outcome: the lead arrived by another route while
    // the failure sat in the queue. Recording it as a failure would be a lie.
    expect(decideAfterAttempt({ kind: 'already_exists' }, 1)).toEqual({
      status: 'resolved',
      resolution: 'already_exists',
    })
  })

  it('a dead token goes terminal immediately, without burning the budget', () => {
    expect(decideAfterAttempt({ kind: 'needs_reconnect' }, 0)).toEqual({
      status: 'dead',
      resolution: 'needs_reconnect',
    })
  })

  it('a Page no longer connected goes terminal immediately', () => {
    expect(decideAfterAttempt({ kind: 'no_connection' }, 0)).toEqual({
      status: 'dead',
      resolution: 'no_connection',
    })
  })

  it('respects a per-row attempt budget', () => {
    expect(decideAfterAttempt({ kind: 'transient', error: 'x' }, 0, 1)).toEqual({
      status: 'dead',
      resolution: 'max_attempts',
    })
  })
})

describe('shouldAlertOnTerminal — urgency must be earned', () => {
  it('alerts only when we exhausted a budget we believed could succeed', () => {
    expect(shouldAlertOnTerminal('max_attempts')).toBe(true)
  })

  it('stays silent for connection problems that already have their own signal', () => {
    // `integration.disconnected` says this better; two alerts for one cause is
    // the notification fatigue the care charter forbids.
    expect(shouldAlertOnTerminal('needs_reconnect')).toBe(false)
    expect(shouldAlertOnTerminal('no_connection')).toBe(false)
  })

  it('never alerts on success', () => {
    expect(shouldAlertOnTerminal('recovered')).toBe(false)
    expect(shouldAlertOnTerminal('already_exists')).toBe(false)
  })
})
