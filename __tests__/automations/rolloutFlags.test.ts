import { afterEach, describe, expect, it } from 'vitest'
import {
  getAutomationsFrom,
  getAutomationsSendMode,
  isAutomationsAgencyAllowlisted,
  isAutomationsEnabled,
  isAutomationsPilotDashboardEnabled,
} from '@/lib/automations/flags'

/**
 * ADR-014 conformance. The rollout's central safety claim is that every flag's
 * MISSING state is its SAFE state — a config wipe, a fresh environment, or a
 * typo'd variable name must all fail closed. These tests are what make that
 * claim enforceable rather than aspirational.
 */

const FLAGS = [
  'AUTOMATIONS_ENABLED',
  'AUTOMATIONS_AGENCY_ALLOWLIST',
  'AUTOMATIONS_SEND_MODE',
  'AUTOMATIONS_FROM',
  'AUTOMATIONS_PILOT_DASHBOARD',
] as const

const clearAll = () => FLAGS.forEach((f) => delete process.env[f])

afterEach(clearAll)

describe('safe by absence', () => {
  it('with NO configuration at all, nothing is enabled', () => {
    clearAll()
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(1)).toBe(false)
    expect(getAutomationsSendMode()).toBe('log')
    expect(getAutomationsFrom()).toBe('')
    expect(isAutomationsPilotDashboardEnabled()).toBe(false)
  })

  it.each(FLAGS)('%s treats an empty value as off', (flag) => {
    clearAll()
    process.env[flag] = ''
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(1)).toBe(false)
    expect(getAutomationsSendMode()).toBe('log')
    expect(isAutomationsPilotDashboardEnabled()).toBe(false)
  })
})

describe('the kill switch requires an exact opt-in', () => {
  it.each(['true', 'yes', 'on', '0', 'TRUE', ' 1 '])('does not accept %o as enabled', (value) => {
    process.env.AUTOMATIONS_ENABLED = value
    expect(isAutomationsEnabled()).toBe(false)
  })

  it('accepts exactly "1"', () => {
    process.env.AUTOMATIONS_ENABLED = '1'
    expect(isAutomationsEnabled()).toBe(true)
  })
})

describe('send mode defaults to observation and needs the literal "live"', () => {
  it.each(['log', 'LIVE', 'live ', 'true', 'yes', 'anything'])('%o resolves to log mode', (value) => {
    process.env.AUTOMATIONS_SEND_MODE = value
    expect(getAutomationsSendMode()).toBe('log')
  })

  it('accepts exactly "live"', () => {
    process.env.AUTOMATIONS_SEND_MODE = 'live'
    expect(getAutomationsSendMode()).toBe('live')
  })
})

describe('allowlist is explicit ids', () => {
  it('admits only the listed agencies', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = '122, 7'
    expect(isAutomationsAgencyAllowlisted(122)).toBe(true)
    expect(isAutomationsAgencyAllowlisted(7)).toBe(true)
    expect(isAutomationsAgencyAllowlisted(8)).toBe(false)
  })

  it('ignores malformed entries rather than admitting everyone', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = 'abc,,-3,0'
    expect(isAutomationsAgencyAllowlisted(3)).toBe(false)
    expect(isAutomationsAgencyAllowlisted(0)).toBe(false)
  })

  it('supports "all" for local development only (ADR-014 forbids it in production)', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = 'all'
    expect(isAutomationsAgencyAllowlisted(999)).toBe(true)
  })
})

describe('flags are independent — no single flag enables sending', () => {
  it('the kill switch alone does not make sending live', () => {
    process.env.AUTOMATIONS_ENABLED = '1'
    expect(getAutomationsSendMode()).toBe('log')
    expect(isAutomationsAgencyAllowlisted(122)).toBe(false)
    expect(getAutomationsFrom()).toBe('')
  })

  it('live mode alone reaches no agency and has no identity', () => {
    process.env.AUTOMATIONS_SEND_MODE = 'live'
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(122)).toBe(false)
    expect(getAutomationsFrom()).toBe('')
  })

  it('all four must be set affirmatively for a customer email to be possible', () => {
    process.env.AUTOMATIONS_ENABLED = '1'
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = '122'
    process.env.AUTOMATIONS_SEND_MODE = 'live'
    process.env.AUTOMATIONS_FROM = 'auto@send.example.com'
    expect(isAutomationsEnabled()).toBe(true)
    expect(isAutomationsAgencyAllowlisted(122)).toBe(true)
    expect(getAutomationsSendMode()).toBe('live')
    expect(getAutomationsFrom()).toBeTruthy()
    // ...and even then, only for agency 122.
    expect(isAutomationsAgencyAllowlisted(123)).toBe(false)
  })
})
