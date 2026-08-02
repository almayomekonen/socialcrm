import { afterEach, describe, expect, it } from 'vitest'
import {
  getAutomationsFrom,
  getAutomationsSendMode,
  isAutomationsAgencyAllowlisted,
  isAutomationsEnabled,
  isAutomationsPilotDashboardEnabled,
} from '@/lib/automations/flags'

/**
 * ADR-014's central safety property: **every flag's absent state is its safe
 * state**, and the flags are multiplicative — no single one enables sending.
 * A config wipe, a fresh environment, or a typo'd variable name must all fail
 * closed. These tests are the executable form of that guarantee.
 */

const VARS = [
  'AUTOMATIONS_ENABLED',
  'AUTOMATIONS_AGENCY_ALLOWLIST',
  'AUTOMATIONS_SEND_MODE',
  'AUTOMATIONS_FROM',
  'AUTOMATIONS_PILOT_DASHBOARD',
]

afterEach(() => {
  for (const v of VARS) delete process.env[v]
})

describe('safe by absence', () => {
  it('with NO configuration at all, nothing is enabled', () => {
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(7)).toBe(false)
    expect(getAutomationsSendMode()).toBe('log')
    expect(getAutomationsFrom()).toBe('')
    expect(isAutomationsPilotDashboardEnabled()).toBe(false)
  })

  it('an empty or malformed value never opens a gate', () => {
    process.env.AUTOMATIONS_ENABLED = ''
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = '   '
    process.env.AUTOMATIONS_SEND_MODE = ''
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(7)).toBe(false)
    expect(getAutomationsSendMode()).toBe('log')
  })

  it('a truthy-looking value that is not the literal flag does not enable', () => {
    process.env.AUTOMATIONS_ENABLED = 'true'
    expect(isAutomationsEnabled()).toBe(false)
    process.env.AUTOMATIONS_PILOT_DASHBOARD = 'yes'
    expect(isAutomationsPilotDashboardEnabled()).toBe(false)
  })
})

describe('send mode — only the literal "live" reaches the transport', () => {
  it.each(['log', 'LIVE', 'Live', 'live ', 'true', '1', 'production'])('%s resolves to log mode', (v) => {
    process.env.AUTOMATIONS_SEND_MODE = v
    expect(getAutomationsSendMode()).toBe('log')
  })

  it('exactly "live" enables live mode', () => {
    process.env.AUTOMATIONS_SEND_MODE = 'live'
    expect(getAutomationsSendMode()).toBe('live')
  })
})

describe('allowlist — explicit ids only', () => {
  it('admits only listed agencies', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = '7, 122'
    expect(isAutomationsAgencyAllowlisted(7)).toBe(true)
    expect(isAutomationsAgencyAllowlisted(122)).toBe(true)
    expect(isAutomationsAgencyAllowlisted(8)).toBe(false)
  })

  it('supports the development-only "all" literal', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = 'all'
    expect(isAutomationsAgencyAllowlisted(999)).toBe(true)
  })

  it('ignores junk entries rather than admitting everyone', () => {
    process.env.AUTOMATIONS_AGENCY_ALLOWLIST = 'abc,,-1,0'
    expect(isAutomationsAgencyAllowlisted(7)).toBe(false)
    expect(isAutomationsAgencyAllowlisted(0)).toBe(false)
  })
})

describe('the flags are multiplicative', () => {
  it('enabling emission alone does not make sending reachable', () => {
    process.env.AUTOMATIONS_ENABLED = '1'
    expect(getAutomationsSendMode()).toBe('log')
    expect(isAutomationsAgencyAllowlisted(7)).toBe(false)
    expect(getAutomationsFrom()).toBe('')
  })

  it('live mode alone does not make an agency eligible', () => {
    process.env.AUTOMATIONS_SEND_MODE = 'live'
    expect(isAutomationsEnabled()).toBe(false)
    expect(isAutomationsAgencyAllowlisted(7)).toBe(false)
  })
})
