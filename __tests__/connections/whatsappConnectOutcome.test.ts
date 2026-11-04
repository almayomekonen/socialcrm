/**
 * Every WhatsApp connect attempt ends with a reason we can read.
 *
 * Production, 2026-09-01 → 09-24: 12 external agencies started Embedded Signup,
 * one reached an operational connection. Of the failures that WERE recorded,
 * every `cancelled` was the same opaque word — Meta's own explanation of where
 * the customer stopped, or which error Meta showed them, arrived as a
 * `WA_EMBEDDED_SIGNUP` / `CANCEL` postMessage and was parsed as `null`.
 * Agency 156 started six attempts on 2026-09-24; two of them (11:30, 11:32)
 * have no outcome at all, because a reload mid-flow records nothing.
 *
 * Meta documents the CANCEL shapes here:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmbeddedSignupGate,
  parseEmbeddedSignupCancel,
  parseEmbeddedSignupMessage,
} from '@/lib/facebook/embeddedSignupSession'
import { clientConnectFailureReason, whatsappLaunchNoticeCode } from '@/lib/connections/connectFailure'
import { clearPendingAttempt, markPendingAttempt, takeAbandonedAttempt } from '@/lib/connections/pendingConnectAttempt'

const FB = 'https://www.facebook.com'
const ABANDONED = { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', version: 3, data: { current_step: 'PHONE_NUMBER_VERIFICATION' } }
const REPORTED = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'CANCEL',
  data: {
    error_message: 'You have guessed too many times.',
    error_id: '524126',
    session_id: 'f34b51dab5e0498',
    timestamp: '1746041036',
  },
}

describe('parseEmbeddedSignupCancel', () => {
  it('reads the screen an abandoned flow stopped on', () => {
    expect(parseEmbeddedSignupCancel(FB, ABANDONED)).toEqual({ step: 'PHONE_NUMBER_VERIFICATION', errorReported: false })
  })

  it('reads an error the customer reported inside the flow, stringified or not', () => {
    // session_id and timestamp are kept (validated) for a Meta support ticket.
    const expected = { errorReported: true, errorMessage: 'You have guessed too many times.', errorId: '524126', sessionId: 'f34b51dab5e0498', timestamp: '1746041036' }
    expect(parseEmbeddedSignupCancel(FB, REPORTED)).toEqual(expected)
    expect(parseEmbeddedSignupCancel(FB, JSON.stringify(REPORTED))).toEqual(expected)
  })

  it('keeps an unknown step as OTHER rather than forwarding Meta’s raw string', () => {
    const msg = { ...ABANDONED, data: { current_step: 'SOME_NEW_SCREEN' } }
    expect(parseEmbeddedSignupCancel(FB, msg)).toEqual({ step: 'OTHER', errorReported: false })
  })

  it('bounds the error text and drops a non-numeric error id', () => {
    const msg = { ...REPORTED, data: { error_message: 'x'.repeat(1000), error_id: 'abc', session_id: 7 } }
    const parsed = parseEmbeddedSignupCancel(FB, msg)
    expect(parsed?.errorMessage).toHaveLength(300)
    expect(parsed?.errorId).toBeUndefined()
    expect(parsed).not.toHaveProperty('sessionId')
  })

  it('strips control and bidi-override characters and collapses whitespace', () => {
    const raw = 'Try\u202Eagain\u0000 in\n\n an\u2066 hour.\u200F'
    const msg = { ...REPORTED, data: { error_message: raw } }
    expect(parseEmbeddedSignupCancel(FB, msg)?.errorMessage).toBe('Try again in an hour.')
  })

  it('an error report that is empty after cleaning is not an error report', () => {
    const msg = { ...REPORTED, data: { error_message: '\u202E\u0000  ' } }
    expect(parseEmbeddedSignupCancel(FB, msg)).toEqual({ errorReported: false })
  })

  it('ignores other origins, other events, and junk', () => {
    expect(parseEmbeddedSignupCancel('https://evilfacebook.com', ABANDONED)).toBeNull()
    expect(parseEmbeddedSignupCancel(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '1' } })).toBeNull()
    expect(parseEmbeddedSignupCancel(FB, 'not json')).toBeNull()
    expect(parseEmbeddedSignupCancel(FB, { type: 'OTHER', event: 'CANCEL' })).toBeNull()
  })

  it('does not change what counts as a completed session', () => {
    expect(parseEmbeddedSignupMessage(FB, ABANDONED)).toBeNull()
  })
})

describe('gate: a cancel carries Meta’s reason, whichever event arrives first', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses a CANCEL message that arrived before the login callback', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptCancel({ step: 'PERMISSIONS', errorReported: false })
    gate.cancel(1000)
    await expect(gate.outcome).resolves.toEqual({ kind: 'cancelled', detail: { step: 'PERMISSIONS', errorReported: false } })
  })

  it('waits briefly for a CANCEL message that arrives after the callback', async () => {
    const gate = createEmbeddedSignupGate()
    gate.cancel(1000)
    vi.advanceTimersByTime(300)
    gate.acceptCancel({ step: 'PHONE_NUMBER_SETUP', errorReported: false })
    await expect(gate.outcome).resolves.toEqual({
      kind: 'cancelled',
      detail: { step: 'PHONE_NUMBER_SETUP', errorReported: false },
    })
  })

  it('settles without detail when Meta sends nothing', async () => {
    const gate = createEmbeddedSignupGate()
    gate.cancel(1000)
    vi.advanceTimersByTime(1000)
    await expect(gate.outcome).resolves.toEqual({ kind: 'cancelled' })
  })

  it('ignores a CANCEL message once the flow has succeeded', async () => {
    const gate = createEmbeddedSignupGate()
    gate.acceptCode('CODE')
    gate.acceptSession({ waba_id: 'W', phone_number_id: 'P', onboardingType: 'cloud_api' })
    gate.acceptCancel({ step: 'PERMISSIONS', errorReported: false })
    await expect(gate.outcome).resolves.toMatchObject({ kind: 'ready' })
  })
})

describe('failure reason and notice', () => {
  const reported = { errorReported: true, errorMessage: 'Try again in an hour.' }

  it('an error Meta showed the customer is a meta_error, not a cancel', () => {
    const result = { ok: false, error: 'cancelled', cancel: reported }
    expect(clientConnectFailureReason(result)).toBe('meta_error')
    expect(whatsappLaunchNoticeCode(result, false)).toBe('meta_error')
    // Worth saying even on a live connection: retrying unchanged will fail again.
    expect(whatsappLaunchNoticeCode(result, true)).toBe('meta_error')
  })

  it('stopping at phone verification gets its own notice when not connected', () => {
    const result = { ok: false, error: 'cancelled', cancel: { step: 'PHONE_NUMBER_VERIFICATION' as const, errorReported: false } }
    expect(clientConnectFailureReason(result)).toBe('cancelled')
    expect(whatsappLaunchNoticeCode(result, false)).toBe('verification_incomplete')
    expect(whatsappLaunchNoticeCode(result, true)).toBeNull()
  })

  it('any other cancel keeps the existing behaviour', () => {
    const result = { ok: false, error: 'cancelled', cancel: { step: 'PERMISSIONS' as const, errorReported: false } }
    expect(whatsappLaunchNoticeCode(result, false)).toBe('not_completed')
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'cancelled' }, false)).toBe('not_completed')
  })
})

describe('pending attempt marker — an attempt ended by reload or navigation', () => {
  function memoryStorage() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
  }

  it('reports an attempt that never reached an outcome, exactly once', () => {
    const s = memoryStorage()
    markPendingAttempt(s, 1_000)
    expect(takeAbandonedAttempt(s, 61_000)).toEqual({ sinceStartMs: 60_000 })
    expect(takeAbandonedAttempt(s, 62_000)).toBeNull()
  })

  it('reports nothing for an attempt that did reach an outcome', () => {
    const s = memoryStorage()
    markPendingAttempt(s, 1_000)
    clearPendingAttempt(s)
    expect(takeAbandonedAttempt(s, 61_000)).toBeNull()
  })

  it('discards a corrupt marker, and never throws when storage does', () => {
    const s = memoryStorage()
    s.setItem('socialcrm:wa-connect-pending', 'garbage')
    expect(takeAbandonedAttempt(s, 5)).toBeNull()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => markPendingAttempt(broken, 1)).not.toThrow()
    expect(() => clearPendingAttempt(broken)).not.toThrow()
    expect(takeAbandonedAttempt(broken, 2)).toBeNull()
  })
})
