import { afterEach, describe, expect, it } from 'vitest'
import { signLeadUnsubscribe, verifyLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'

// Lead-scoped unsubscribe token (ADR-003): HMAC over (agencyId, leadId).
// Tokens live in inboxes forever — these properties are frozen at first live
// send. Cross-domain non-interaction with the platform's userId token is a
// Phase 5 route test.

afterEach(() => {
  delete process.env.AUTOMATIONS_UNSUBSCRIBE_SECRET
})

describe('signLeadUnsubscribe / verifyLeadUnsubscribe', () => {
  it('round-trips for the same (agency, lead)', () => {
    const token = signLeadUnsubscribe(7, 42)
    expect(verifyLeadUnsubscribe(7, 42, token)).toBe(true)
  })

  it('is deterministic for the same inputs', () => {
    expect(signLeadUnsubscribe(7, 42)).toBe(signLeadUnsubscribe(7, 42))
  })

  it('rejects a cross-agency token (tenant isolation)', () => {
    const token = signLeadUnsubscribe(7, 42)
    expect(verifyLeadUnsubscribe(8, 42, token)).toBe(false)
  })

  it('rejects a cross-lead token', () => {
    const token = signLeadUnsubscribe(7, 42)
    expect(verifyLeadUnsubscribe(7, 43, token)).toBe(false)
  })

  it('rejects tampered and empty tokens', () => {
    const token = signLeadUnsubscribe(7, 42)
    expect(verifyLeadUnsubscribe(7, 42, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).toBe(false)
    expect(verifyLeadUnsubscribe(7, 42, '')).toBe(false)
    expect(verifyLeadUnsubscribe(7, 42, 'short')).toBe(false)
  })

  it('ambiguous id concatenations do not collide (agency 7/lead 42 vs agency 74/lead 2)', () => {
    expect(signLeadUnsubscribe(7, 42)).not.toBe(signLeadUnsubscribe(74, 2))
  })

  it('tokens are bound to the engine secret', () => {
    const before = signLeadUnsubscribe(7, 42)
    process.env.AUTOMATIONS_UNSUBSCRIBE_SECRET = 'rotated-secret'
    const after = signLeadUnsubscribe(7, 42)
    expect(after).not.toBe(before)
    expect(verifyLeadUnsubscribe(7, 42, before)).toBe(false)
    expect(verifyLeadUnsubscribe(7, 42, after)).toBe(true)
  })
})
