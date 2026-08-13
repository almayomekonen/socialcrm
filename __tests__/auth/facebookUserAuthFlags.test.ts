import { describe, beforeEach, afterEach, test, expect } from 'vitest'
import {
  isFacebookUserAuthEnabled,
  isFacebookUserAuthAgencyAllowlisted,
  canUseFacebookUserAuth,
  isFacebookUserAuthPubliclyAvailable,
  isFacebookUserAuthOpenToNewAgencies,
} from '@/lib/auth/facebookUserAuthFlags'

const ENV = process.env.FACEBOOK_USER_AUTH_ENABLED
const LIST = process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST

function setEnv(enabled?: string, allowlist?: string) {
  if (enabled === undefined) delete process.env.FACEBOOK_USER_AUTH_ENABLED
  else process.env.FACEBOOK_USER_AUTH_ENABLED = enabled
  if (allowlist === undefined) delete process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST
  else process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST = allowlist
}

beforeEach(() => setEnv(undefined, undefined))
afterEach(() => setEnv(ENV, LIST))

describe('FACEBOOK_USER_AUTH rollout gate', () => {
  test('unset env blocks everyone', () => {
    expect(isFacebookUserAuthEnabled()).toBe(false)
    expect(canUseFacebookUserAuth(103)).toBe(false)
    expect(isFacebookUserAuthPubliclyAvailable()).toBe(false)
    expect(isFacebookUserAuthOpenToNewAgencies()).toBe(false)
  })

  test('master switch alone still admits nobody', () => {
    setEnv('1', undefined)
    expect(isFacebookUserAuthEnabled()).toBe(true)
    expect(canUseFacebookUserAuth(103)).toBe(false)
    expect(isFacebookUserAuthPubliclyAvailable()).toBe(false)
  })

  test('allowlist alone still admits nobody', () => {
    setEnv(undefined, '103')
    expect(isFacebookUserAuthAgencyAllowlisted(103)).toBe(true)
    expect(canUseFacebookUserAuth(103)).toBe(false)
  })

  test('both gates admit only the named agencies', () => {
    setEnv('1', '103')
    expect(canUseFacebookUserAuth(103)).toBe(true)
    expect(canUseFacebookUserAuth(104)).toBe(false)
    expect(canUseFacebookUserAuth(1)).toBe(false)
    expect(isFacebookUserAuthPubliclyAvailable()).toBe(true)
    expect(isFacebookUserAuthOpenToNewAgencies()).toBe(false)
  })

  test('CSV allowlist expands without a code change', () => {
    setEnv('1', '103, 104, 105')
    expect(canUseFacebookUserAuth(103)).toBe(true)
    expect(canUseFacebookUserAuth(104)).toBe(true)
    expect(canUseFacebookUserAuth(105)).toBe(true)
    expect(canUseFacebookUserAuth(106)).toBe(false)
  })

  test('"all" opens existing-user login and new-agency registration', () => {
    setEnv('1', 'all')
    expect(canUseFacebookUserAuth(999)).toBe(true)
    expect(isFacebookUserAuthOpenToNewAgencies()).toBe(true)
  })

  test('a missing or zero agencyId can never pass', () => {
    setEnv('1', 'all')
    expect(canUseFacebookUserAuth(null)).toBe(false)
    expect(canUseFacebookUserAuth(undefined)).toBe(false)
    expect(canUseFacebookUserAuth(0)).toBe(false)
  })
})
