/**
 * getAgentAvailability — the one Agent eligibility decision (lib/ai/agentAvailability.ts).
 *
 * Real flag parsing (AI_ENABLED, AGENT_AGENCY_IDS, AGENT_AUDIENCE,
 * AGENT_EXCLUDED_AGENCY_IDS); product access mocked per case. The list mode is
 * pinned to today's behaviour so this change does not move the Production
 * audience; `paid` and `all` are new and off unless AGENT_AUDIENCE names them.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { access } = vi.hoisted(() => ({ access: vi.fn() }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: access }))

import { _resetAiEnvCacheForTests } from '@/lib/ai/env'
import { agentAudience, agentExcludedAgencyIds, getAgentAvailability } from '@/lib/ai/agentAvailability'

const VARS = ['AI_ENABLED', 'AGENT_AGENCY_IDS', 'AGENT_AUDIENCE', 'AGENT_EXCLUDED_AGENCY_IDS']
const PAID = { status: 'PAID', hasAccess: true }
const LEGACY = { status: 'LEGACY', hasAccess: true }
const TRIAL = { status: 'TRIAL_ACTIVE', hasAccess: true }
const EXPIRED = { status: 'TRIAL_EXPIRED', hasAccess: false }
const NEVER = { status: 'NEVER_STARTED', hasAccess: false }
const UNKNOWN = { status: 'UNKNOWN', hasAccess: true }

function env(vars: Record<string, string | undefined>) {
  for (const k of VARS) delete process.env[k]
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v
  _resetAiEnvCacheForTests()
}
const decide = async (agencyId: number, productAccess: object = PAID) => {
  access.mockResolvedValue(productAccess)
  return getAgentAvailability(agencyId)
}

beforeEach(() => access.mockReset())
afterEach(() => env({}))

describe('list (AGENT_AUDIENCE unset or "list") — today\'s behaviour, unchanged', () => {
  it('an allowlisted agency with product access may use the Agent', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '103,161' })
    expect(agentAudience()).toBe('list')
    expect(await decide(103)).toEqual({ available: true, audience: 'list' })
    expect(await decide(161, TRIAL)).toEqual({ available: true, audience: 'list' })
  })

  it('a non-allowlisted agency may not, whatever its plan', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '103' })
    expect(await decide(200, PAID)).toMatchObject({ available: false, reason: 'not_in_audience' })
    expect(access).not.toHaveBeenCalled() // no read for an agency outside the list
  })

  it('"list" spelled out behaves exactly as unset', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '103', AGENT_AUDIENCE: 'list' })
    expect(await decide(103)).toMatchObject({ available: true })
    expect(await decide(104)).toMatchObject({ available: false, reason: 'not_in_audience' })
  })

  it('mixed tokens in the id list are ids only: "1,all,*" is agency 1, never everyone', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '1,all,*' })
    expect(await decide(1)).toMatchObject({ available: true })
    expect(await decide(2)).toMatchObject({ available: false, reason: 'not_in_audience' })
  })

  it('a whole-value AGENT_AGENCY_IDS=all keeps its existing meaning (compatibility; to be replaced by AGENT_AUDIENCE)', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: 'all' })
    expect(await decide(999)).toMatchObject({ available: true, audience: 'list' })
  })
})

describe('paid and all', () => {
  it('paid: PAID and LEGACY yes; an active trial no', async () => {
    env({ AI_ENABLED: '1', AGENT_AUDIENCE: 'paid' })
    expect(await decide(10, PAID)).toEqual({ available: true, audience: 'paid' })
    expect(await decide(11, LEGACY)).toEqual({ available: true, audience: 'paid' })
    expect(await decide(12, TRIAL)).toMatchObject({ available: false, reason: 'not_in_audience' })
  })

  it('all: PAID, LEGACY and an active trial', async () => {
    env({ AI_ENABLED: '1', AGENT_AUDIENCE: 'all' })
    for (const a of [PAID, LEGACY, TRIAL]) expect(await decide(20, a)).toEqual({ available: true, audience: 'all' })
  })

  it('neither mode needs the id list', async () => {
    env({ AI_ENABLED: '1', AGENT_AUDIENCE: 'all' })
    expect(await decide(31, PAID)).toMatchObject({ available: true })
  })
})

describe('denials that hold in every mode', () => {
  it.each(['list', 'paid', 'all'])('%s: an expired trial and a trial never started are refused', async (mode) => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '40', AGENT_AUDIENCE: mode })
    expect(await decide(40, EXPIRED)).toMatchObject({ available: false, reason: 'no_product_access' })
    expect(await decide(40, NEVER)).toMatchObject({ available: false, reason: 'no_product_access' })
  })

  it.each(['list', 'paid', 'all'])(
    '%s: an excluded agency is refused before anything is read, even when allowlisted',
    async (mode) => {
      env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: '50', AGENT_AUDIENCE: mode, AGENT_EXCLUDED_AGENCY_IDS: '50' })
      expect(await decide(50, PAID)).toMatchObject({ available: false, reason: 'excluded' })
      expect(access).not.toHaveBeenCalled()
    },
  )

  it('a whole-value AGENT_AGENCY_IDS=all does not override an exclusion', async () => {
    env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: 'all', AGENT_EXCLUDED_AGENCY_IDS: '51' })
    expect(await decide(51)).toMatchObject({ available: false, reason: 'excluded' })
  })

  it.each(['list', 'paid', 'all'])('%s: AI disabled globally means nobody', async (mode) => {
    env({ AGENT_AGENCY_IDS: '60', AGENT_AUDIENCE: mode })
    expect(await decide(60, PAID)).toMatchObject({ available: false })
    expect(access).not.toHaveBeenCalled()
  })

  it.each(['everyone', 'ALL', 'true', '*', 'paid,all', ' list '.repeat(2)])(
    'an unknown AGENT_AUDIENCE (%j) fails closed for everyone',
    async (bad) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      env({ AI_ENABLED: '1', AGENT_AGENCY_IDS: 'all', AGENT_AUDIENCE: bad })
      expect(agentAudience()).toBeNull()
      expect(await decide(70, PAID)).toMatchObject({ available: false, reason: 'invalid_audience' })
      warn.mockRestore()
    },
  )

  it('no agency means no Agent', async () => {
    env({ AI_ENABLED: '1', AGENT_AUDIENCE: 'all' })
    for (const id of [0, -1, NaN, 1.5])
      expect(await getAgentAvailability(id)).toMatchObject({ available: false, reason: 'no_agency' })
    expect(await getAgentAvailability(null)).toMatchObject({ available: false, reason: 'no_agency' })
  })
})

describe('the exclusion list parser', () => {
  it('takes plain digits only: "all", "*" and junk exclude nobody and are never read as ids', () => {
    env({ AGENT_EXCLUDED_AGENCY_IDS: 'all, *, 12, abc, 12, 0, -3, 7' })
    expect(agentExcludedAgencyIds()).toEqual([12, 7])
  })
})

describe('a failed product-access read', () => {
  it('fails open (UNKNOWN) exactly as the layout and the AI gate do — the WhatsApp identity keeps its own fail-closed check', async () => {
    env({ AI_ENABLED: '1', AGENT_AUDIENCE: 'paid' })
    expect(await decide(80, UNKNOWN)).toMatchObject({ available: true })
  })
})

describe('one decision for every surface', () => {
  const SURFACES = [
    'app/(app)/agent/page.tsx',
    'app/(app)/layout.tsx',
    'app/(app)/m/page.tsx',
    'app/api/ai/agent/route.ts',
    'app/api/ai/agent/stream/route.ts',
    'app/api/ai/agent/transcribe/route.ts',
    'lib/agent/actions/bridge.ts',
    'lib/waAssistant/identity.ts',
  ]
  it.each(SURFACES)('%s decides through isAgentAvailable, never isAgentEnabled directly', (file) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(src).toMatch(/await isAgentAvailable\(/)
    expect(src).not.toMatch(/\bisAgentEnabled\(/)
  })
})
