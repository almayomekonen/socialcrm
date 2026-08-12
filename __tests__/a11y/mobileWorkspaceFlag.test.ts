// Gate semantics for the mobile workspace rollout flag.
//
// This is the one switch standing between "phones are redirected to /activate,
// as they always have been" and "phones enter the real product". Getting it
// wrong exposes an unfinished mobile workspace to every customer at once, so
// the absence-blocks behaviour is asserted rather than assumed.
//
// Guarantees locked in:
//   1. Unset env ⇒ OFF. Production and every preview today are unchanged.
//   2. Master switch alone ⇒ still nobody. An empty allowlist means no agency.
//   3. Allowlist alone ⇒ still nobody. Both gates are required.
//   4. Only the named agencies pass; a neighbouring id does not.
//   5. 'all' is honoured, but only together with the master switch.
//   6. A missing/zero agencyId can never pass.
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, beforeEach, afterEach, test, expect } from 'vitest'
import {
  isMobileWorkspaceEnabled,
  isMobileWorkspaceAgencyAllowlisted,
  canEnterMobileWorkspace,
} from '@/lib/flags/mobileFlags'

const ENV = process.env.MOBILE_WORKSPACE_ENABLED
const LIST = process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST

function setEnv(enabled?: string, allowlist?: string) {
  if (enabled === undefined) delete process.env.MOBILE_WORKSPACE_ENABLED
  else process.env.MOBILE_WORKSPACE_ENABLED = enabled
  if (allowlist === undefined) delete process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST
  else process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST = allowlist
}

beforeEach(() => setEnv(undefined, undefined))
afterEach(() => setEnv(ENV, LIST))

describe('MOBILE_WORKSPACE_ENABLED gate', () => {
  test('1. unset env blocks everyone — shipping this changes nothing', () => {
    expect(isMobileWorkspaceEnabled()).toBe(false)
    expect(canEnterMobileWorkspace(122)).toBe(false)
  })

  test('2. master switch alone still admits nobody (empty allowlist = no agency)', () => {
    setEnv('1', undefined)
    expect(isMobileWorkspaceEnabled()).toBe(true)
    expect(canEnterMobileWorkspace(122)).toBe(false)
  })

  test('3. allowlist alone still admits nobody (master switch off)', () => {
    setEnv(undefined, '122,133')
    expect(isMobileWorkspaceAgencyAllowlisted(122)).toBe(true)
    expect(canEnterMobileWorkspace(122)).toBe(false)
  })

  test('4. both gates ⇒ only the named agencies pass', () => {
    setEnv('1', '122, 133')
    expect(canEnterMobileWorkspace(122)).toBe(true)
    expect(canEnterMobileWorkspace(133)).toBe(true)
    expect(canEnterMobileWorkspace(134)).toBe(false)
    expect(canEnterMobileWorkspace(1)).toBe(false)
  })

  test('4b. production allowlist 103,23 admits only those two agencies', () => {
    setEnv('1', '103,23')
    expect(canEnterMobileWorkspace(103)).toBe(true)
    expect(canEnterMobileWorkspace(23)).toBe(true)
    expect(canEnterMobileWorkspace(1)).toBe(false)
    expect(canEnterMobileWorkspace(122)).toBe(false)
    expect(canEnterMobileWorkspace(0)).toBe(false)
  })

  test('5. "all" is honoured, but only with the master switch on', () => {
    setEnv(undefined, 'all')
    expect(canEnterMobileWorkspace(999)).toBe(false)
    setEnv('1', 'all')
    expect(canEnterMobileWorkspace(999)).toBe(true)
  })

  test('6. a missing or zero agencyId can never pass', () => {
    setEnv('1', 'all')
    expect(canEnterMobileWorkspace(null)).toBe(false)
    expect(canEnterMobileWorkspace(undefined)).toBe(false)
    expect(canEnterMobileWorkspace(0)).toBe(false)
  })

  test('only the exact string "1" enables — not "true", not "yes"', () => {
    for (const v of ['true', 'yes', '0', '', 'TRUE']) {
      setEnv(v, 'all')
      expect(canEnterMobileWorkspace(122)).toBe(false)
    }
  })

  test('malformed allowlist entries are ignored, never coerced to an id', () => {
    setEnv('1', 'abc, -5, 0, 122')
    expect(canEnterMobileWorkspace(122)).toBe(true)
    expect(canEnterMobileWorkspace(0)).toBe(false)
    expect(canEnterMobileWorkspace(-5)).toBe(false)
  })
})
