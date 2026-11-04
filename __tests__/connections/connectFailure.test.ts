/**
 * WhatsApp launch outcomes → analytics reason and notice code.
 *
 * Two guarantees locked in:
 *   1. Only failures the server never sees get a client reason. Server-originated
 *      codes return null, because the embedded-signup route already records its
 *      own `whatsapp_connect_failed` — reporting them here would double-count.
 *   2. `cancelled` is silent on a live connection (unchanged) but explained when
 *      there is no connection yet (new): silence there left agency 149 tapping
 *      the same button with no reason given.
 */
import { describe, expect, it } from 'vitest'
import {
  CLIENT_CONNECT_FAILURE_REASONS,
  clientConnectFailureReason,
  whatsappLaunchNoticeCode,
} from '@/lib/connections/connectFailure'
import { FACEBOOK_NOTICES, WHATSAPP_NOTICES, facebookNotice, whatsappNotice } from '@/lib/connections/messages'

describe('clientConnectFailureReason', () => {
  it('a successful launch has no failure reason', () => {
    expect(clientConnectFailureReason({ ok: true })).toBeNull()
  })

  it.each([
    [{ ok: false, error: 'cancelled' }, 'cancelled'],
    [{ ok: false, error: 'sdk' }, 'sdk'],
    [{ ok: false, error: 'config' }, 'config'],
    [{ ok: false, error: 'network' }, 'network'],
    [{ ok: false, error: 'missing_details' }, 'session'],
  ])('%o → %s', (result, expected) => {
    expect(clientConnectFailureReason(result)).toBe(expected)
  })

  it('pending is not a failure: the window may still be open', () => {
    expect(clientConnectFailureReason({ ok: false, error: 'pending' })).toBeNull()
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'pending' }, false)).toBe('pending')
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'pending' }, true)).toBe('pending')
  })

  it.each(['token', 'no_phones', 'no_accounts', 'denied', 'resource_claimed', 'subscribe_incomplete', 'server'])(
    'server-originated %s is not reported from the client',
    (error) => {
      expect(clientConnectFailureReason({ ok: false, error })).toBeNull()
    },
  )

  it('every reason it can produce is in the allowlisted vocabulary', () => {
    const produced = [
      { ok: false, error: 'cancelled' },
      { ok: false, error: 'sdk' },
      { ok: false, error: 'config' },
      { ok: false, error: 'network' },
      { ok: false, error: 'missing_details' },
      { ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: 'x' } },
    ].map(clientConnectFailureReason)
    // `abandoned` is not produced by this mapper: it is reported on the next
    // visit by useEmbeddedSignup from lib/connections/pendingConnectAttempt.ts.
    // `timeout` is no longer produced: only a tab from before pending can send it.
    expect(new Set([...produced, 'abandoned', 'timeout'])).toEqual(new Set(CLIENT_CONNECT_FAILURE_REASONS))
  })
})

describe('whatsappLaunchNoticeCode', () => {
  it('success shows nothing', () => {
    expect(whatsappLaunchNoticeCode({ ok: true }, false)).toBeNull()
  })

  it('cancelled with no connection explains that the connection was not completed', () => {
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'cancelled' }, false)).toBe('not_completed')
  })

  it('cancelled on a live connection stays silent, leaving the health notice in place', () => {
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'cancelled' }, true)).toBeNull()
  })

  it('other errors pass through unchanged, with the existing token fallback', () => {
    expect(whatsappLaunchNoticeCode({ ok: false, error: 'sdk' }, false)).toBe('sdk')
    expect(whatsappLaunchNoticeCode({ ok: false }, false)).toBe('token')
  })
})

describe('notice registry', () => {
  it('not_completed is a calm, retryable notice', () => {
    const notice = whatsappNotice('not_completed')
    expect(notice).toBe(WHATSAPP_NOTICES.not_completed)
    expect(notice?.tone).toBe('attention')
    expect(notice?.action).toBe('לנסות שוב')
  })

  it('both channels share one in-app browser notice whose action lets the user continue', () => {
    expect(whatsappNotice('in_app_browser')).toBe(facebookNotice('in_app_browser'))
    expect(FACEBOOK_NOTICES.in_app_browser.action).toBe('לנסות בכל זאת')
    expect(FACEBOOK_NOTICES.in_app_browser.nextStep).toMatch(/Safari/)
  })

  it('a bare cancelled code is still silent', () => {
    expect(whatsappNotice('cancelled')).toBeNull()
  })
})
