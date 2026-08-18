// The device-class contract — which application entity a request receives.
//
// This is the decision that keeps the two SocialCRM entities apart:
//
//   Phone request   → Phone shell   → phone presentation
//   Desktop request → Desktop shell → desktop presentation
//
// Getting it wrong does not produce a subtle layout bug; it produces a desktop
// table inside a 390px mobile shell, or mobile chrome flashing on a laptop. The
// classification is therefore asserted against REAL User-Agent strings rather
// than against a mock of our own parser.
//
// Guarantees locked in (do not weaken):
//   1. Phone User-Agents classify as 'phone'.
//   2. Desktop User-Agents classify as 'desktop'.
//   3. TABLETS classify as 'desktop' — a product decision, not an accident.
//   4. ?device=phone works ONLY in development.
//   5. ?device=desktop works ONLY in development.
//   6. Production ignores the override completely, whatever the header says.
//   7. The override moves the DEVICE answer only — never the rollout gate,
//      which still admits exactly the allowlisted agencies (103, 23).
//
// No DB: `npm run test:a11y` (VITEST_NO_DB=1).

import { describe, beforeEach, afterEach, test, expect, vi } from 'vitest'

/**
 * `getDeviceClass()` reads `headers()`. The mock hands it a real `Headers`
 * object, so `userAgent()` runs its genuine parse — the test exercises the
 * shipping code path, not a stand-in for it.
 */
let requestHeaders = new Headers()
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }))

import { deviceClassFromHeaders, getDeviceClass, isMobileRequest, isMobileWorkspaceRequest } from '@/lib/device'
import { DEVICE_OVERRIDE_HEADER, isDeviceOverrideAllowed, parseDeviceOverride } from '@/lib/deviceOverride'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function request(ua: string, override?: string) {
  const h = new Headers({ 'user-agent': ua })
  if (override !== undefined) h.set(DEVICE_OVERRIDE_HEADER, override)
  requestHeaders = h
}

const NODE = process.env.NODE_ENV
const setNode = (v: string | undefined) => {
  if (v === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
  else (process.env as Record<string, string | undefined>).NODE_ENV = v
}

const ENABLED = process.env.MOBILE_WORKSPACE_ENABLED
const LIST = process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST
function setMobileEnv(enabled?: string, allowlist?: string) {
  if (enabled === undefined) delete process.env.MOBILE_WORKSPACE_ENABLED
  else process.env.MOBILE_WORKSPACE_ENABLED = enabled
  if (allowlist === undefined) delete process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST
  else process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST = allowlist
}

beforeEach(() => {
  requestHeaders = new Headers()
  setMobileEnv(undefined, undefined)
})
afterEach(() => {
  setNode(NODE)
  setMobileEnv(ENABLED, LIST)
})

describe('User-Agent classification', () => {
  test('1. phone User-Agents are phones', async () => {
    for (const ua of [UA.iphone, UA.androidPhone]) {
      request(ua)
      expect(await getDeviceClass(), ua).toBe('phone')
      expect(await isMobileRequest()).toBe(true)
    }
  })

  test('2. desktop User-Agents are desktop', async () => {
    for (const ua of [UA.macChrome, UA.macSafari, UA.windowsChrome]) {
      request(ua)
      expect(await getDeviceClass(), ua).toBe('desktop')
      expect(await isMobileRequest()).toBe(false)
    }
  })

  test('3. TABLETS are desktop — explicit product decision, not a fallthrough', async () => {
    for (const ua of [UA.ipad, UA.androidTablet]) {
      request(ua)
      expect(await getDeviceClass(), ua).toBe('desktop')
    }
  })

  test('an absent or junk User-Agent falls back to desktop, never to phone', async () => {
    for (const ua of ['', 'curl/8.4.0', 'Mozilla/5.0']) {
      request(ua)
      expect(await getDeviceClass(), ua).toBe('desktop')
    }
  })

  test('the pure classifier agrees with the request-bound one', () => {
    expect(deviceClassFromHeaders(new Headers({ 'user-agent': UA.iphone }))).toBe('phone')
    expect(deviceClassFromHeaders(new Headers({ 'user-agent': UA.macChrome }))).toBe('desktop')
    expect(deviceClassFromHeaders(new Headers({ 'user-agent': UA.ipad }))).toBe('desktop')
  })
})

describe('development device override', () => {
  test('4. ?device=phone makes a desktop User-Agent render the phone entity', async () => {
    setNode('development')
    request(UA.macChrome, 'phone')
    expect(await getDeviceClass()).toBe('phone')
    expect(await isMobileRequest()).toBe(true)
  })

  test('5. ?device=desktop makes an iPhone render the desktop entity', async () => {
    setNode('development')
    request(UA.iphone, 'desktop')
    expect(await getDeviceClass()).toBe('desktop')
    expect(await isMobileRequest()).toBe(false)
  })

  test('no override falls through to the real User-Agent, even in development', async () => {
    setNode('development')
    request(UA.iphone)
    expect(await getDeviceClass()).toBe('phone')
    request(UA.macChrome)
    expect(await getDeviceClass()).toBe('desktop')
  })

  test('only the exact vocabulary overrides — junk is no override at all', async () => {
    setNode('development')
    for (const v of ['tablet', 'mobile', 'PHONE', '1', 'true', '']) {
      request(UA.macChrome, v)
      expect(await getDeviceClass(), v).toBe('desktop')
      expect(parseDeviceOverride(v)).toBeNull()
    }
  })

  test('6. PRODUCTION ignores the override entirely — the header cannot move the answer', async () => {
    setNode('production')
    expect(isDeviceOverrideAllowed()).toBe(false)

    request(UA.macChrome, 'phone')
    expect(await getDeviceClass()).toBe('desktop')

    request(UA.iphone, 'desktop')
    expect(await getDeviceClass()).toBe('phone')
  })

  test('under vitest the override is INACTIVE, so every UA assertion above is production-shaped', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(isDeviceOverrideAllowed()).toBe(false)
    request(UA.macChrome, 'phone')
    expect(await getDeviceClass()).toBe('desktop')
  })

  test('an unset NODE_ENV does not enable the override (fails closed)', async () => {
    setNode(undefined)
    request(UA.macChrome, 'phone')
    expect(await getDeviceClass()).toBe('desktop')
  })
})

describe('7. the override never touches the rollout gate', () => {
  test('production config: the override cannot admit an agency the allowlist excludes', async () => {
    setNode('production')
    setMobileEnv('1', '103,23')

    // A real phone from an allowlisted agency enters the mobile workspace…
    request(UA.iphone)
    expect(await isMobileWorkspaceRequest(103)).toBe(true)
    expect(await isMobileWorkspaceRequest(23)).toBe(true)

    // …and everyone else stays out, override header or not.
    for (const id of [1, 39, 102, 104, 122, 230, 1023]) {
      expect(await isMobileWorkspaceRequest(id), `agency ${id}`).toBe(false)
    }

    request(UA.macChrome, 'phone')
    for (const id of [103, 23, 1, 122]) {
      expect(await isMobileWorkspaceRequest(id), `agency ${id} via spoofed header`).toBe(false)
    }
  })

  test('production: a phone from an unlisted agency is not the mobile workspace', async () => {
    setNode('production')
    setMobileEnv('1', '103,23')
    request(UA.iphone)
    expect(await getDeviceClass()).toBe('phone')
    expect(await isMobileWorkspaceRequest(122)).toBe(false)
  })

  /**
   * THE OVERRIDE DOES NOT RELAX THE ROLLOUT GATE — not even in development.
   *
   * `?device=phone` answers "is this request a phone". It has no say in "may
   * this agency enter the mobile workspace", which remains
   * `MOBILE_WORKSPACE_ENABLED=1` AND the agency in the allowlist, in every
   * environment. With the flags unset, a forced phone still gets nothing.
   *
   * Written this way deliberately. An earlier draft asserted that development
   * admits ANY authenticated agency — that described a local dev-bypass helper
   * that is NOT part of this release, so asserting it here would have been
   * asserting a behaviour the shipped code does not have.
   */
  test('development: the override cannot admit an agency the allowlist excludes', async () => {
    setNode('development')
    setMobileEnv(undefined, undefined)
    request(UA.macChrome, 'phone')
    for (const id of [1, 39, 103, 23, 999, 12345]) {
      expect(await isMobileWorkspaceRequest(id), `agency ${id}`).toBe(false)
    }

    // With the real production config, exactly the allowlisted agencies pass —
    // and the forced device class changes nothing about which ones.
    setMobileEnv('1', '103,23')
    expect(await isMobileWorkspaceRequest(103)).toBe(true)
    expect(await isMobileWorkspaceRequest(23)).toBe(true)
    for (const id of [1, 39, 122, 999]) {
      expect(await isMobileWorkspaceRequest(id), `agency ${id}`).toBe(false)
    }

    // Identity is never relaxed, in any environment.
    expect(await isMobileWorkspaceRequest(null)).toBe(false)
    expect(await isMobileWorkspaceRequest(undefined)).toBe(false)
    expect(await isMobileWorkspaceRequest(0)).toBe(false)
  })

  test('development: ?device=desktop keeps a real phone OUT of the mobile workspace', async () => {
    setNode('development')
    request(UA.iphone, 'desktop')
    expect(await isMobileWorkspaceRequest(103)).toBe(false)
  })
})
