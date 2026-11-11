import { afterEach, describe, expect, it } from 'vitest'
import { isWaAssistantQuotesAgency, isWaAssistantQuotesSendAgency, isWaAssistantTasksAgency, waAssistantQuotesForAll } from '@/lib/flags/waAssistantFlags'

/**
 * Quote creation: an explicit list, or `WA_ASSISTANT_QUOTES_AUDIENCE=all` (owner
 * decision, 2026-11-10). Either way only on top of the assistant itself, and an
 * excluded agency never.
 */
const KEYS = ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_AUDIENCE', 'WA_ASSISTANT_EXCLUDED_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AUDIENCE', 'WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_SEND_AUDIENCE', 'WA_ASSISTANT_TASKS_AUDIENCE']

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('the quotes switch', () => {
  it('absent means nobody, even with the assistant open to every agency', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
    expect(waAssistantQuotesForAll()).toBe(false)
  })

  it('another capability’s `all` does not open quotes', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_TASKS_AUDIENCE = 'all'
    expect(isWaAssistantTasksAgency(103)).toBe(true)
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
  })

  it('"all" inside the id list names nobody', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = 'all'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
  })

  it('a listed agency needs the assistant too, and an exclusion still wins', () => {
    process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
    process.env.WA_ASSISTANT_AGENCY_IDS = '103,104'
    expect(isWaAssistantQuotesAgency(103)).toBe(true)
    expect(isWaAssistantQuotesAgency(104)).toBe(false)
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
  })

  it('QUOTES_AUDIENCE=all opens creation to every agency in the assistant’s audience', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    for (const id of [103, 104, 99999]) expect(isWaAssistantQuotesAgency(id)).toBe(true)
    expect(waAssistantQuotesForAll()).toBe(true)
  })

  it('…but never outside the assistant’s audience, never for an excluded agency, never for a bad id', () => {
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesAgency(103)).toBe(true)
    expect(isWaAssistantQuotesAgency(104)).toBe(false)
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
    for (const bad of [0, -1, null, undefined, 1.5]) expect(isWaAssistantQuotesAgency(bad as never)).toBe(false)
  })

  it('only the exact word `all` counts', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    for (const v of ['ALL', 'yes', '1', 'true', 'all,103']) {
      process.env.WA_ASSISTANT_QUOTES_AUDIENCE = v
      expect(isWaAssistantQuotesAgency(103)).toBe(false)
    }
  })

  it('QUOTES_AUDIENCE=all never opens customer sending: that stays the explicit list', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    for (const id of [103, 104]) expect(isWaAssistantQuotesSendAgency(id)).toBe(false)
    process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS = 'all'
    expect(isWaAssistantQuotesSendAgency(103)).toBe(false)
    process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesSendAgency(103)).toBe(true)
    expect(isWaAssistantQuotesSendAgency(104)).toBe(false)
  })

  it('QUOTES_SEND_AUDIENCE=all opens sending to every agency that may create quotes', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_SEND_AUDIENCE = 'all'
    for (const id of [103, 104, 99999]) expect(isWaAssistantQuotesSendAgency(id)).toBe(true)
  })

  it('…never without quote creation, never outside the audience, never for an excluded agency or a bad id', () => {
    process.env.WA_ASSISTANT_QUOTES_SEND_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    expect(isWaAssistantQuotesSendAgency(103)).toBe(false)
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    delete process.env.WA_ASSISTANT_AUDIENCE
    process.env.WA_ASSISTANT_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesSendAgency(103)).toBe(true)
    expect(isWaAssistantQuotesSendAgency(104)).toBe(false)
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = '103'
    expect(isWaAssistantQuotesSendAgency(103)).toBe(false)
    for (const bad of [0, -1, null, undefined, 1.5]) expect(isWaAssistantQuotesSendAgency(bad as never)).toBe(false)
  })

  it('only the exact word `all` opens sending', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    for (const v of ['ALL', 'yes', '1', 'true', 'all,103']) {
      process.env.WA_ASSISTANT_QUOTES_SEND_AUDIENCE = v
      expect(isWaAssistantQuotesSendAgency(103)).toBe(false)
    }
  })
})
