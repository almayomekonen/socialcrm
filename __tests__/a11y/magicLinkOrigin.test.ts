import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveBaseUrl } from '@/types/vars'

/**
 * The origin every emailed sign-in link is built from (actions/auth.ts sendToken).
 *
 * THE BUG THIS PINS. A magic-link token is written to the database of the
 * environment that issued it. Staging issued links pointing at
 * getsocialcrm.com, so the token was verified against production's database,
 * which had never seen it — every staging email sign-in failed, and the owner
 * landed on production instead. Two independent causes, both live at once:
 * APP_URL / NEXT_PUBLIC_APP_URL are shared Production+Preview variables holding
 * the production origin, and NODE_ENV is 'production' in every Vercel build
 * including previews.
 *
 * The origin is only ever read from configuration we control. Never from a Host
 * or X-Forwarded-* header — those come from the caller, and trusting one would
 * let anybody redirect our sign-in emails to a host of their choosing.
 */

const PROD = 'https://getsocialcrm.com'
const STAGING = 'socialcrm-git-feat-card-required-trial-almayos-projects.vercel.app'

afterEach(() => vi.unstubAllEnvs())

/** The shared variables a preview inherits from production. */
function inheritProductionVars() {
  vi.stubEnv('APP_URL', PROD)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', PROD)
  vi.stubEnv('NODE_ENV', 'production')
}

describe('resolveBaseUrl', () => {
  it('production is unchanged: the configured production origin', () => {
    inheritProductionVars()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('APP_HOST', 'getsocialcrm.com')
    vi.stubEnv('VERCEL_URL', 'socialcrm-abc123-almayos-projects.vercel.app')
    expect(resolveBaseUrl()).toBe(PROD)
  })

  it('staging mints its own origin, not the inherited production one', () => {
    inheritProductionVars()
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('APP_HOST', STAGING)
    expect(resolveBaseUrl()).toBe(`https://${STAGING}`)
  })

  it('accepts APP_HOST with a scheme or a trailing slash', () => {
    inheritProductionVars()
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('APP_HOST', `https://${STAGING}/`)
    expect(resolveBaseUrl()).toBe(`https://${STAGING}`)
  })

  it('a preview that merely inherited the production APP_HOST falls back to its own deployment URL', () => {
    // The security-relevant case: a preview must never mint a production link
    // just because it inherited the production host.
    inheritProductionVars()
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('APP_HOST', 'getsocialcrm.com')
    vi.stubEnv('VERCEL_URL', 'socialcrm-abc123-almayos-projects.vercel.app')
    expect(resolveBaseUrl()).toBe('https://socialcrm-abc123-almayos-projects.vercel.app')
  })

  it('no preview deployment can resolve to production, whatever it inherits', () => {
    for (const env of ['preview', 'development']) {
      inheritProductionVars()
      vi.stubEnv('VERCEL_ENV', env)
      vi.stubEnv('APP_HOST', 'getsocialcrm.com')
      vi.stubEnv('VERCEL_URL', 'socialcrm-xyz-almayos-projects.vercel.app')
      expect(resolveBaseUrl()).not.toBe(PROD)
    }
  })

  it('local development is untouched — no VERCEL_ENV, no new behaviour', () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('APP_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_HOST', 'localhost:3000')
    expect(resolveBaseUrl()).toBe('http://localhost:3000')
  })
})
