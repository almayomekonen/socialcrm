import { describe, it, expect } from 'vitest'
import { classifyError, isPermanentError } from '@/lib/ai/router/errorClassify'

const err = (m: string) => new Error(m)

describe('classifyError — permanent provider failures', () => {
  it('classifies billing/credit exhaustion (the live Anthropic error)', () => {
    expect(classifyError(err('Your credit balance is too low to access the Anthropic API.'))).toBe('billing')
  })

  it('classifies quota exhaustion (the live Google error) — quota wins over rate-limit', () => {
    expect(classifyError(err('You exceeded your current quota, please check your plan. rate-limits'))).toBe('quota')
  })

  it('classifies invalid API key and auth failures', () => {
    expect(classifyError(err('Invalid API key provided'))).toBe('invalid-key')
    expect(classifyError(err('401 Unauthorized'))).toBe('auth')
    expect(classifyError(err('authentication failed'))).toBe('auth')
  })

  it('still classifies transient buckets', () => {
    expect(classifyError(err('Rate limit reached, retry shortly'))).toBe('rate-limit')
    expect(classifyError(err('Request aborted'))).toBe('timeout')
    expect(classifyError(err('something weird'))).toBe('unknown')
  })
})

describe('isPermanentError — the no-retry set', () => {
  it('treats deterministic failures as permanent', () => {
    for (const c of ['billing', 'quota', 'invalid-key', 'auth', 'bad-request']) {
      expect(isPermanentError(c)).toBe(true)
    }
  })

  it('treats transient failures as retryable', () => {
    for (const c of ['rate-limit', 'timeout', 'server-error', 'unknown']) {
      expect(isPermanentError(c)).toBe(false)
    }
  })
})
