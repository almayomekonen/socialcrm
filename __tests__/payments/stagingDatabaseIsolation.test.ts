import { describe, it, expect } from 'vitest'
import { resolveDatabaseUrl } from '@/config/db'

/**
 * The Neon marketplace integration injects DATABASE_URL into every environment
 * it is connected to, and that injection outranks a branch-scoped project
 * variable. A staging preview therefore read PRODUCTION until STAGING_DATABASE_URL
 * existed. These assertions pin the two directions that matter: production and
 * local runs must be untouched, and a staging deployment must never fall back to
 * the shared database.
 */
const SHARED = 'postgres://u:p@prod-endpoint.neon.tech/neondb?sslmode=require'
const ISOLATED = 'postgres://u:p@staging-endpoint.neon.tech/neondb?sslmode=require'

describe('resolveDatabaseUrl', () => {
  it('leaves production alone', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: SHARED, VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'production' })).toBe(SHARED)
    // Even a production deployment that somehow carries both variables.
    expect(
      resolveDatabaseUrl({ DATABASE_URL: SHARED, STAGING_DATABASE_URL: ISOLATED, VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'staging' }),
    ).toBe(SHARED)
  })

  it('leaves local and test runs alone, staging or not', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: SHARED })).toBe(SHARED)
    expect(resolveDatabaseUrl({ DATABASE_URL: SHARED, APP_ENV: 'staging', STAGING_DATABASE_URL: ISOLATED })).toBe(SHARED)
    expect(resolveDatabaseUrl({ DATABASE_URL: SHARED, APP_ENV: 'test' })).toBe(SHARED)
  })

  it('leaves other preview branches alone — they do not declare staging', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: SHARED, VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'production' })).toBe(SHARED)
  })

  it('uses the isolated database on a staging deployment', () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: SHARED, STAGING_DATABASE_URL: ISOLATED, VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'staging' }),
    ).toBe(ISOLATED)
  })

  it('fails closed instead of borrowing production', () => {
    const staging = { DATABASE_URL: SHARED, VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'staging' }
    expect(() => resolveDatabaseUrl(staging)).toThrow(/needs STAGING_DATABASE_URL/)
    expect(() => resolveDatabaseUrl({ ...staging, STAGING_DATABASE_URL: '   ' })).toThrow(/needs STAGING_DATABASE_URL/)
    expect(() => resolveDatabaseUrl({ ...staging, STAGING_DATABASE_URL: SHARED })).toThrow(/not an isolated database/)
  })
})
