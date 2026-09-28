/**
 * The idempotency key, and the decision table a second attempt runs through.
 *
 * These are the cheapest tests in the layer and the ones protecting the most
 * expensive failure: a duplicate mutation against a real customer's CRM. The key
 * must be STABLE across everything that does not change the action's meaning,
 * and DIFFERENT for everything that does.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  decideOnExistingClaim,
  deriveIdempotencyKey,
  hashArgs,
} from '@/lib/agent/actions'
import { EXECUTION_LEASE_MS } from '@/lib/agent/actions/idempotency'

const base = { agencyId: 7, actionType: 'create_task', agentRunId: 'run_1' }

describe('canonicalisation', () => {
  it('makes key order irrelevant at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('preserves array order, because order is meaning there', () => {
    expect(canonicalJson({ ids: [2, 1] })).not.toBe(canonicalJson({ ids: [1, 2] }))
  })

  it('treats an explicitly-undefined field as an absent one', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })

  it('does not confuse a null with a missing value', () => {
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }))
  })
})

describe('the derived key', () => {
  it('is identical for the same action asked twice in one run', () => {
    expect(deriveIdempotencyKey({ ...base, args: { leadId: 1 } }))
      .toBe(deriveIdempotencyKey({ ...base, args: { leadId: 1 } }))
  })

  it('survives argument reordering — the retry case that matters', () => {
    expect(deriveIdempotencyKey({ ...base, args: { a: 1, b: 2 } }))
      .toBe(deriveIdempotencyKey({ ...base, args: { b: 2, a: 1 } }))
  })

  it('differs when any argument differs', () => {
    expect(deriveIdempotencyKey({ ...base, args: { leadId: 1 } }))
      .not.toBe(deriveIdempotencyKey({ ...base, args: { leadId: 2 } }))
  })

  it('differs across action types and across tenants', () => {
    const a = deriveIdempotencyKey({ ...base, args: {} })
    expect(a).not.toBe(deriveIdempotencyKey({ ...base, actionType: 'create_follow_up', args: {} }))
    expect(a).not.toBe(deriveIdempotencyKey({ ...base, agencyId: 8, args: {} }))
  })

  it('differs across investigations — asking again tomorrow is a new intent', () => {
    expect(deriveIdempotencyKey({ ...base, args: {} }))
      .not.toBe(deriveIdempotencyKey({ ...base, agentRunId: 'run_2', args: {} }))
  })

  it('is not random — the one property a key must never have', () => {
    const keys = new Set(Array.from({ length: 20 }, () => deriveIdempotencyKey({ ...base, args: { x: 1 } })))
    expect(keys.size).toBe(1)
  })
})

describe('the args hash an approval binds to', () => {
  it('is stable under reordering and changes with any value', () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }))
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }))
  })

  it('is not the idempotency key — a plan grant covers several distinct keys', () => {
    expect(hashArgs({ a: 1 })).not.toBe(deriveIdempotencyKey({ ...base, args: { a: 1 } }))
  })
})

describe('what a second attempt may do', () => {
  const at = (executionState: string, ageMs = 0) => ({ executionState, updatedAtMs: 1_000_000 - ageMs })
  const NOW = 1_000_000

  it('proceeds when nothing was ever claimed', () => {
    expect(decideOnExistingClaim(null, NOW)).toEqual({ kind: 'PROCEED' })
  })

  it('reports a completed action rather than repeating it', () => {
    expect(decideOnExistingClaim(at('SUCCEEDED'), NOW)).toEqual({ kind: 'ALREADY_EXECUTED' })
  })

  it('allows a retry after a definitive failure — nothing was written', () => {
    expect(decideOnExistingClaim(at('FAILED'), NOW)).toEqual({ kind: 'RETRY_ALLOWED' })
    expect(decideOnExistingClaim(at('NOT_EXECUTED'), NOW)).toEqual({ kind: 'RETRY_ALLOWED' })
  })

  it('recognises a live twin inside the lease', () => {
    expect(decideOnExistingClaim(at('EXECUTING', 500), NOW)).toEqual({ kind: 'IN_FLIGHT' })
    expect(decideOnExistingClaim(at('PENDING', 500), NOW)).toEqual({ kind: 'IN_FLIGHT' })
  })

  it('sends an abandoned EXECUTING row to reconciliation, never to a retry', () => {
    // The process died mid-mutation. Whether it committed is unknowable from
    // here, and a retry is exactly how one lost response becomes two records.
    expect(decideOnExistingClaim(at('EXECUTING', EXECUTION_LEASE_MS + 1), NOW)).toEqual({ kind: 'RECONCILE' })
  })

  it('lets an abandoned PENDING row be retried — the executor was never reached', () => {
    expect(decideOnExistingClaim(at('PENDING', EXECUTION_LEASE_MS + 1), NOW)).toEqual({ kind: 'RETRY_ALLOWED' })
  })

  it('never retries an UNKNOWN outcome', () => {
    expect(decideOnExistingClaim(at('UNKNOWN'), NOW)).toEqual({ kind: 'RECONCILE' })
  })

  it('fails closed on a state it does not recognise', () => {
    expect(decideOnExistingClaim(at('WAT'), NOW)).toEqual({ kind: 'RECONCILE' })
  })

  it('treats a missing timestamp as abandoned rather than as live', () => {
    expect(decideOnExistingClaim({ executionState: 'EXECUTING' }, NOW)).toEqual({ kind: 'RECONCILE' })
  })
})
