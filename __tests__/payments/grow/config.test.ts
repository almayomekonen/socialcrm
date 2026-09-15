import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  getGrowApiConfig,
  assertGrowRuntime,
  publicAppOrigin,
  isCardRequiredTrialEnabled,
  areSubscriptionChargesEnabled,
  GROW_SANDBOX_BASE_URL,
} from '@/lib/payments/grow/config'

// The runner's own environment must not leak into these cases.
const RUNTIME_KEYS = ['APP_ENV', 'GROW_MODE', 'VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_ENV', 'GROW_SANDBOX_ISOLATED_DATA']

beforeEach(() => {
  for (const k of RUNTIME_KEYS) vi.stubEnv(k, '')
})
afterEach(() => vi.unstubAllEnvs())

function ids(mode: string) {
  vi.stubEnv('GROW_MODE', mode)
  vi.stubEnv('GROW_USER_ID', ' user-1 ')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'page-1')
}

describe('getGrowApiConfig', () => {
  it('derives the sandbox base URL from GROW_MODE and trims identifiers', () => {
    ids('sandbox')
    expect(getGrowApiConfig()).toEqual({
      mode: 'sandbox',
      baseUrl: 'https://sandbox.meshulam.co.il/api/light/server/1.0',
      userId: 'user-1',
      tokenPageCode: 'page-1',
    })
    expect(GROW_SANDBOX_BASE_URL).toBe('https://sandbox.meshulam.co.il/api/light/server/1.0')
  })

  it('derives the production base URL from GROW_MODE', () => {
    ids('production')
    expect(getGrowApiConfig().baseUrl).toBe('https://secure.meshulam.co.il/api/light/server/1.0')
  })

  it('refuses an unknown mode', () => {
    ids('live')
    expect(() => getGrowApiConfig()).toThrow('grow.config.mode_invalid')
  })

  it('refuses missing identifiers', () => {
    ids('sandbox')
    vi.stubEnv('GROW_USER_ID', '')
    expect(() => getGrowApiConfig()).toThrow('grow.config.user_id_missing')
    vi.stubEnv('GROW_USER_ID', 'u')
    vi.stubEnv('GROW_PAGE_CODE_TOKEN', '  ')
    expect(() => getGrowApiConfig()).toThrow('grow.config.token_page_code_missing')
  })
})

describe('assertGrowRuntime — real money', () => {
  it('allows production mode only on the Vercel Production deployment', () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('GROW_MODE', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(assertGrowRuntime()).toEqual({ env: 'production', mode: 'production' })
  })

  it('accepts the NEXT_PUBLIC_VERCEL_ENV signal the repo already uses when VERCEL_ENV is absent', () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('GROW_MODE', 'production')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(assertGrowRuntime()).toEqual({ env: 'production', mode: 'production' })
  })

  it('refuses production mode on a Preview deployment, which today inherits production values and database', () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('GROW_MODE', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(() => assertGrowRuntime()).toThrow('grow.runtime.production_requires_vercel_production')
  })

  it('refuses production mode when the deployment is not identifiable (fails closed)', () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('GROW_MODE', 'production')
    expect(() => assertGrowRuntime()).toThrow('grow.runtime.production_requires_vercel_production')
  })
})

describe('assertGrowRuntime — sandbox', () => {
  it('allows staging + sandbox only with an explicit isolated-data attestation', () => {
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(() => assertGrowRuntime()).toThrow('grow.runtime.sandbox_requires_isolated_data')
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
    expect(assertGrowRuntime()).toEqual({ env: 'staging', mode: 'sandbox' })
  })

  it('refuses sandbox mode on the Vercel Production deployment even with the attestation', () => {
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
    expect(() => assertGrowRuntime()).toThrow('grow.runtime.sandbox_on_production_deployment')
  })

  it.each([
    ['production', 'sandbox'],
    ['staging', 'production'],
    ['local', 'sandbox'],
    ['test', 'sandbox'],
  ])('refuses APP_ENV=%s with GROW_MODE=%s', (env, mode) => {
    vi.stubEnv('APP_ENV', env)
    vi.stubEnv('GROW_MODE', mode)
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
    expect(() => assertGrowRuntime()).toThrow('grow.runtime.env_mode_mismatch')
  })
})

describe('publicAppOrigin', () => {
  it('builds an https origin from APP_HOST', () => {
    vi.stubEnv('APP_HOST', 'getsocialcrm.com')
    expect(publicAppOrigin()).toBe('https://getsocialcrm.com')
  })

  it('refuses localhost, because Grow cannot call it', () => {
    vi.stubEnv('APP_HOST', 'localhost:3000')
    expect(() => publicAppOrigin()).toThrow('grow.config.localhost_not_allowed')
  })

  it('refuses a missing host', () => {
    vi.stubEnv('APP_HOST', '')
    expect(() => publicAppOrigin()).toThrow('grow.config.app_host_missing')
  })
})

describe('flags are absence-blocks', () => {
  it('are on only for the exact string "true"', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '1')
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'TRUE')
    expect(isCardRequiredTrialEnabled()).toBe(false)
    expect(areSubscriptionChargesEnabled()).toBe(false)
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true')
    expect(isCardRequiredTrialEnabled()).toBe(true)
    expect(areSubscriptionChargesEnabled()).toBe(true)
  })
})
