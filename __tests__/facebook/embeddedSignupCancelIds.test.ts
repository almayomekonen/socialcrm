/** Meta's CANCEL message: error_id and session_id are kept whenever well-formed, and nothing else. */
import { describe, expect, it } from 'vitest'
import { parseEmbeddedSignupCancel } from '@/lib/facebook/embeddedSignupSession'

const FB = 'https://www.facebook.com'
const msg = (data: Record<string, unknown>) => JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data })

describe('parseEmbeddedSignupCancel ids', () => {
  it('keeps session_id and error_id with a reported error', () => {
    expect(parseEmbeddedSignupCancel(FB, msg({ error_message: 'Ineligible', error_id: '524126', session_id: 'f1a2B3_c-4' }))).toEqual({
      errorReported: true, errorMessage: 'Ineligible', errorId: '524126', sessionId: 'f1a2B3_c-4',
    })
  })

  it('keeps session_id with an abandoned screen, and a numeric error_id', () => {
    expect(parseEmbeddedSignupCancel(FB, msg({ current_step: 'PHONE_NUMBER_SETUP', session_id: 'abc123', error_id: 99 }))).toEqual({
      step: 'PHONE_NUMBER_SETUP', errorReported: false, errorId: '99', sessionId: 'abc123',
    })
  })

  it("reads Meta's current error_code field, preferring it over the older error_id", () => {
    // Meta's documented example: error_code '524126', session_id 'f34b51dab5e0498'.
    expect(parseEmbeddedSignupCancel(FB, msg({ error_message: 'x', error_code: '524126', session_id: 'f34b51dab5e0498', timestamp: '1746041036' }))).toEqual({
      errorReported: true, errorMessage: 'x', errorId: '524126', sessionId: 'f34b51dab5e0498',
    })
    expect(parseEmbeddedSignupCancel(FB, msg({ error_code: '1', error_id: '2' }))?.errorId).toBe('1')
    expect(parseEmbeddedSignupCancel(FB, msg({ error_code: 'bad', error_id: '2' }))?.errorId).toBe('2')
  })

  it('keeps ids even when the message has neither a step nor a message', () => {
    expect(parseEmbeddedSignupCancel(FB, msg({ session_id: 'abc123' }))).toEqual({ errorReported: false, sessionId: 'abc123' })
  })

  it('drops malformed ids, missing fields and anything unexpected', () => {
    for (const data of [
      { session_id: 'has space', error_id: '12a' },
      { session_id: '<script>', error_id: -1 },
      { session_id: 'x'.repeat(129), error_id: '1'.repeat(21) },
      { session_id: 42, error_id: { id: 1 } },
      { session_id: 'f34b51dab5e0498 ', error_code: '12 34' },
      {},
    ]) {
      const c = parseEmbeddedSignupCancel(FB, msg(data))!
      expect(c.sessionId).toBeUndefined()
      expect(c.errorId).toBeUndefined()
    }
  })

  it('still ignores other origins and other events', () => {
    expect(parseEmbeddedSignupCancel('https://evilfacebook.com', msg({ session_id: 'abc' }))).toBeNull()
    expect(parseEmbeddedSignupCancel(FB, JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { session_id: 'abc' } }))).toBeNull()
  })
})
