import { afterEach, describe, expect, it } from 'vitest'
import { isWaAssistantQuotesEmailInviteAgency, isWaAssistantQuotesSendAgency } from '@/lib/flags/waAssistantFlags'

/**
 * The email invitation's audience, as Production configures the all-agency
 * Quotes V2 rollout: every `_AUDIENCE` set to exactly `all`. Pure env reads.
 */

const KEYS = [
  'WA_ASSISTANT_AUDIENCE',
  'WA_ASSISTANT_AGENCY_IDS',
  'WA_ASSISTANT_EXCLUDED_AGENCY_IDS',
  'WA_ASSISTANT_QUOTES_AUDIENCE',
  'WA_ASSISTANT_QUOTES_AGENCY_IDS',
  'WA_ASSISTANT_QUOTES_SEND_AUDIENCE',
  'WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS',
  'WA_ASSISTANT_QUOTES_EMAIL_INVITE_AUDIENCE',
  'WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS',
] as const
const set = (env: Partial<Record<(typeof KEYS)[number], string>>) => Object.assign(process.env, env)
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

const ALL = {
  WA_ASSISTANT_AUDIENCE: 'all',
  WA_ASSISTANT_QUOTES_AUDIENCE: 'all',
  WA_ASSISTANT_QUOTES_SEND_AUDIENCE: 'all',
  WA_ASSISTANT_QUOTES_EMAIL_INVITE_AUDIENCE: 'all',
} as const

describe('the email invitation audience', () => {
  it('all-agency rollout: every agency that may send quotes, including ones no list names', () => {
    set(ALL)
    for (const id of [1, 103, 167, 99999]) expect(isWaAssistantQuotesEmailInviteAgency(id)).toBe(true)
  })

  it('an agency excluded from the assistant never gets it, whatever the audiences say', () => {
    set({ ...ALL, WA_ASSISTANT_EXCLUDED_AGENCY_IDS: '167' })
    expect(isWaAssistantQuotesEmailInviteAgency(167)).toBe(false)
    expect(isWaAssistantQuotesEmailInviteAgency(103)).toBe(true)
  })

  it('only on top of customer sending: the invitation alone opens nothing', () => {
    set({ ...ALL, WA_ASSISTANT_QUOTES_SEND_AUDIENCE: '' })
    expect(isWaAssistantQuotesSendAgency(103)).toBe(false)
    expect(isWaAssistantQuotesEmailInviteAgency(103)).toBe(false)
  })

  it('absence blocks: with no invitation switch, no agency gets it', () => {
    set({ ...ALL, WA_ASSISTANT_QUOTES_EMAIL_INVITE_AUDIENCE: '' })
    expect(isWaAssistantQuotesEmailInviteAgency(103)).toBe(false)
  })

  it('exactly "all" opens it; a list names only its own agencies', () => {
    set({ ...ALL, WA_ASSISTANT_QUOTES_EMAIL_INVITE_AUDIENCE: 'ALL ' })
    expect(isWaAssistantQuotesEmailInviteAgency(103)).toBe(false)
    set({ WA_ASSISTANT_QUOTES_EMAIL_INVITE_AUDIENCE: '', WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS: '103' })
    expect(isWaAssistantQuotesEmailInviteAgency(103)).toBe(true)
    expect(isWaAssistantQuotesEmailInviteAgency(167)).toBe(false)
  })
})
