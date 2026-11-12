import { afterEach, describe, expect, it } from 'vitest'
import { canUseConversationalAgent, conversationalAgentAudience, conversationalAgentAgencyIds } from '@/lib/flags/conversationalAgentFlags'

/**
 * IRE_CONVERSATIONAL_AGENCY_IDS: `all` (every agency, current and future) or an
 * explicit numeric list. Anything else fails closed.
 */

const ENV = 'IRE_CONVERSATIONAL_AGENCY_IDS'
afterEach(() => {
  delete process.env[ENV]
})

describe('all', () => {
  it('opens it to every agency, including one created after the value was set', () => {
    process.env[ENV] = 'all'
    for (const id of [103, 69, 167, 1, 2_000_000]) expect(canUseConversationalAgent(id)).toBe(true)
    expect(conversationalAgentAudience()).toBe('all')
  })

  it('is trimmed and case-insensitive', () => {
    for (const v of ['ALL', ' all ', '\tAll\n']) expect(canUseConversationalAgent(555, v)).toBe(true)
  })

  it('never makes an invalid agency id eligible', () => {
    for (const id of [0, -1, 1.5, Number.NaN, null, undefined]) expect(canUseConversationalAgent(id as number, 'all')).toBe(false)
  })

  it('only the exact value: `*`, `everyone` or `all` inside a list is not all', () => {
    expect(canUseConversationalAgent(555, '*')).toBe(false)
    expect(canUseConversationalAgent(555, 'everyone')).toBe(false)
    expect(canUseConversationalAgent(555, 'all,103')).toBe(false)
    expect(canUseConversationalAgent(103, 'all,103')).toBe(true)
  })
})

describe('numeric lists (unchanged behaviour)', () => {
  it('names exactly the listed agencies, with whitespace tolerated', () => {
    process.env[ENV] = ' 103, 69 ,167 '
    for (const id of [103, 69, 167]) expect(canUseConversationalAgent(id)).toBe(true)
    expect(canUseConversationalAgent(168)).toBe(false)
    expect([...conversationalAgentAgencyIds()]).toEqual([103, 69, 167])
  })

  it('ignores invalid entries without failing the valid ones', () => {
    expect(canUseConversationalAgent(103, '103, x, 7x, -4, 0, 1.5, ')).toBe(true)
    expect(canUseConversationalAgent(7, '103, x, 7x, -4, 0, 1.5, ')).toBe(false)
  })

  it('a newly created agency is not eligible under a list until it is named', () => {
    expect(canUseConversationalAgent(999, '103,69,167')).toBe(false)
  })
})

describe('fails closed', () => {
  it('unset, empty, whitespace or garbage means no agency', () => {
    expect(canUseConversationalAgent(103)).toBe(false)
    for (const v of ['', '   ', ',,', 'yes', 'true', '1x']) expect(canUseConversationalAgent(103, v)).toBe(false)
  })
})
