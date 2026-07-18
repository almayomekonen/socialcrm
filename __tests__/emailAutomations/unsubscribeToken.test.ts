import { describe, it, expect, beforeAll } from 'vitest'
import { signUnsubscribe, verifyUnsubscribe } from '@/lib/emailAutomations/unsubscribeToken'

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'
})

describe('unsubscribe token', () => {
  it('round-trips a valid token', () => {
    const t = signUnsubscribe(42)
    expect(verifyUnsubscribe(42, t)).toBe(true)
  })

  it('rejects a token for a different user', () => {
    const t = signUnsubscribe(42)
    expect(verifyUnsubscribe(43, t)).toBe(false)
  })

  it('rejects a tampered / empty token', () => {
    const t = signUnsubscribe(42)
    expect(verifyUnsubscribe(42, t + 'x')).toBe(false)
    expect(verifyUnsubscribe(42, '')).toBe(false)
  })
})
