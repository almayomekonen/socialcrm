import { afterEach, describe, expect, it } from 'vitest'
import { isWaAssistantQuotesAgency, isWaAssistantTasksAgency } from '@/lib/flags/waAssistantFlags'

/**
 * Other capabilities can be opened to every agency with WA_ASSISTANT_<X>_AUDIENCE=all.
 * Quotes cannot: only an agency named in WA_ASSISTANT_QUOTES_AGENCY_IDS gets them.
 */
const KEYS = ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_AUDIENCE', 'WA_ASSISTANT_EXCLUDED_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AUDIENCE', 'WA_ASSISTANT_TASKS_AUDIENCE']

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('the quotes switch is an explicit allowlist', () => {
  it('absent means nobody, even with the assistant open to every agency', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
  })

  it('an audience of all opens other capabilities and never quotes', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_TASKS_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_QUOTES_AUDIENCE = 'all'
    expect(isWaAssistantTasksAgency(103)).toBe(true)
    expect(isWaAssistantQuotesAgency(103)).toBe(false)
  })

  it('"all" in the list itself names nobody', () => {
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
})
