/** Embedded Signup postMessage origins: HTTPS Facebook only — the bare domain, known subdomains and real *.facebook.com. */
import { describe, expect, it } from 'vitest'
import { isFacebookOrigin, parseEmbeddedSignupMessage } from '@/lib/facebook/embeddedSignupSession'

describe('isFacebookOrigin', () => {
  it.each(['https://facebook.com', 'https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com', 'https://m.facebook.com'])('accepts %s', (o) => {
    expect(isFacebookOrigin(o)).toBe(true)
  })

  it.each([
    'http://facebook.com',
    'http://www.facebook.com',
    'https://evilfacebook.com',
    'https://facebook.com.evil.com',
    'https://notfacebook.com',
    'https://facebook.co',
    'https://fb.com',
    'https://facebook.com@evil.com',
    'wss://facebook.com',
    'null',
    '',
    'facebook.com',
  ])('rejects %s', (o) => {
    expect(isFacebookOrigin(o)).toBe(false)
  })

  it('a completion from the bare domain is parsed; the same message from a look-alike is not', () => {
    const msg = JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'W', phone_number_id: 'P' } })
    expect(parseEmbeddedSignupMessage('https://facebook.com', msg)).toEqual({ waba_id: 'W', phone_number_id: 'P', onboardingType: 'cloud_api' })
    expect(parseEmbeddedSignupMessage('https://evilfacebook.com', msg)).toBeNull()
  })
})
