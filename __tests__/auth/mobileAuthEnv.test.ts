/**
 * Boot-time validation of the mobile auth configuration.
 *
 * These assert a DEPLOYMENT property: a production server that cannot possibly
 * authenticate a phone must refuse to start, rather than serving 500s from a
 * handler whose logs say only "failed". The check is pure, so no database or
 * network is involved.
 */
import { describe, expect, it } from 'vitest'
import { checkMobileAuthEnv } from '@/lib/startup/checkMobileAuthEnv'

const GOOD_SECRET = 'a'.repeat(48)

/** A minimal environment that should pass cleanly. */
function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'web-secret-which-is-different',
    MOBILE_JWT_SECRET: GOOD_SECRET,
    MOBILE_GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com',
    ...overrides,
  } as NodeJS.ProcessEnv
}

describe('mobile auth env — fatal in production', () => {
  it('passes when the signing key and an audience are configured', () => {
    expect(checkMobileAuthEnv(baseEnv()).status).toBe('ok')
  })

  it('is FATAL when the signing key is missing', () => {
    const result = checkMobileAuthEnv(baseEnv({ MOBILE_JWT_SECRET: undefined }))
    expect(result.status).toBe('fatal')
    expect(result.issues[0].variable).toBe('MOBILE_JWT_SECRET')
  })

  it('is FATAL when the signing key is too short to be a key', () => {
    expect(checkMobileAuthEnv(baseEnv({ MOBILE_JWT_SECRET: 'short' })).status).toBe('fatal')
  })

  it('is FATAL when the mobile key equals the web key', () => {
    /**
     * The two key classes must not be interchangeable: `JWT_SECRET` also signs
     * `encrypt()` output — fb_pages, WhatsApp numbers, the deal-export link —
     * with a 365-day lifetime.
     */
    const result = checkMobileAuthEnv(
      baseEnv({ MOBILE_JWT_SECRET: GOOD_SECRET, JWT_SECRET: GOOD_SECRET }),
    )
    expect(result.status).toBe('fatal')
    expect(result.issues[0].problem).toContain('identical to JWT_SECRET')
  })

  it('never reveals a secret value in what it reports', () => {
    // A distinctive value, so a match proves a LEAK rather than colliding with
    // an ordinary word in the message text.
    const secret = 'sekrit-canary-9f3a'
    const result = checkMobileAuthEnv(baseEnv({ MOBILE_JWT_SECRET: secret }))

    expect(result.status).toBe('fatal')
    expect(JSON.stringify(result)).not.toContain(secret)
    // Length is reported; the value is not.
    expect(result.issues[0].problem).toContain(String(secret.length))
  })
})

describe('mobile auth env — non-fatal signals', () => {
  it('warns, but does not fail, when no Google client ID is configured', () => {
    // The verifier already fails closed on an empty audience list, so this is a
    // "nobody can sign in" warning rather than a "server is broken" error.
    const result = checkMobileAuthEnv(
      baseEnv({ MOBILE_GOOGLE_IOS_CLIENT_ID: undefined, NEXT_PUBLIC_GGLID: undefined }),
    )
    expect(result.status).toBe('warn')
  })

  it('warns when development sign-in variables leak into production', () => {
    const result = checkMobileAuthEnv(baseEnv({ MOBILE_DEV_AUTH_SECRET: 'leaked' }))
    expect(result.status).toBe('warn')
    expect(result.issues.some((i) => i.variable.includes('MOBILE_DEV_AUTH'))).toBe(true)
  })

  it('never fails outside production, so web-only work needs no mobile secrets', () => {
    const result = checkMobileAuthEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)
    expect(result.status).toBe('warn')
    expect(result.issues.every((i) => i.fatal === false)).toBe(true)
  })
})
