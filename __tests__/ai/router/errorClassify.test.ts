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
    for (const c of ['billing', 'quota', 'model-unavailable', 'invalid-key', 'auth', 'bad-request']) {
      expect(isPermanentError(c)).toBe(true)
    }
  })

  it('treats transient failures as retryable', () => {
    for (const c of ['rate-limit', 'timeout', 'server-error', 'unknown']) {
      expect(isPermanentError(c)).toBe(false)
    }
  })
})

/** An AI SDK APICallError-shaped error: a message plus the provider's HTTP status. */
const apiErr = (message: string, statusCode: number) => Object.assign(new Error(message), { name: 'AI_APICallError', statusCode })

describe('classifyError — regression: a digit 5 in the text is not a server error', () => {
  const LIVE_GEMINI =
    'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements.'

  it('the live Gemini refusal is a permanent model-unavailable, with or without a status', () => {
    expect(classifyError(err(LIVE_GEMINI))).toBe('model-unavailable')
    expect(classifyError(apiErr(LIVE_GEMINI, 404))).toBe('model-unavailable')
    expect(classifyError(apiErr(LIVE_GEMINI, 400))).toBe('model-unavailable')
    expect(isPermanentError(classifyError(err(LIVE_GEMINI)))).toBe(true) // fail over, never retry
  })

  it('model names and other numbers containing 5 do not make an error look like a 5xx', () => {
    expect(classifyError(err('Unexpected token in response from gpt-5.6'))).toBe('unknown')
    expect(classifyError(err('claude-sonnet-4-5 returned an empty object'))).toBe('unknown')
    expect(classifyError(err('Request id 7a5b failed schema validation after 15 steps'))).toBe('unknown')
  })

  it('real 5xx failures are still server errors (transient, retryable)', () => {
    expect(classifyError(apiErr('Internal error', 500))).toBe('server-error')
    expect(classifyError(apiErr('upstream', 503))).toBe('server-error')
    expect(classifyError(err('502 Bad Gateway'))).toBe('server-error')
    expect(classifyError(err('Overloaded'))).toBe('server-error')
    expect(classifyError(err('Internal Server Error'))).toBe('server-error')
    expect(isPermanentError('server-error')).toBe(false)
  })
})

describe('classifyError — the HTTP status decides the transport class', () => {
  it('maps statuses to codes', () => {
    expect(classifyError(apiErr('nope', 401))).toBe('auth')
    expect(classifyError(apiErr('forbidden', 403))).toBe('auth')
    expect(classifyError(apiErr('missing', 404))).toBe('model-unavailable')
    expect(classifyError(apiErr('slow', 408))).toBe('timeout')
    expect(classifyError(apiErr('slow down', 429))).toBe('rate-limit')
    expect(classifyError(apiErr('bad field', 422))).toBe('bad-request')
    expect(classifyError(apiErr('bad field', 400))).toBe('bad-request')
  })

  it('billing and quota text win over the status (Anthropic sends its credit error as a 400)', () => {
    expect(classifyError(apiErr('Your credit balance is too low to access the Anthropic API.', 400))).toBe('billing')
    expect(classifyError(apiErr('You exceeded your current quota, please check your plan and billing details.', 429))).toBe(
      'billing',
    )
    expect(classifyError(apiErr('You exceeded your current quota.', 429))).toBe('quota')
  })

  it('reads the status through the SDK wrappers (RetryError.lastError, cause)', () => {
    const retry = Object.assign(new Error('Failed after 3 attempts. Last error: Service Unavailable'), {
      name: 'AI_RetryError',
      lastError: apiErr('Service Unavailable', 503),
    })
    expect(classifyError(retry)).toBe('server-error')
    const wrapped = Object.assign(new Error('call failed'), { cause: apiErr('nope', 401) })
    expect(classifyError(wrapped)).toBe('auth')
    const retryModel = Object.assign(new Error('Failed after 1 attempt.'), {
      name: 'AI_RetryError',
      lastError: apiErr('model_not_found', 404),
    })
    expect(classifyError(retryModel)).toBe('model-unavailable')
  })

  it('timeouts and aborts by name as well as by text', () => {
    expect(classifyError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))).toBe('timeout')
    expect(classifyError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))).toBe('timeout')
  })

  it('never throws on odd input', () => {
    for (const x of [undefined, null, 42, 'a string', {}, { statusCode: 'x' }, { status: 9999 }]) {
      expect(() => classifyError(x)).not.toThrow()
    }
    expect(classifyError(undefined)).toBe('unknown')
  })
})
