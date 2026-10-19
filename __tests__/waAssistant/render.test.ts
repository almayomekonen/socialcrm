import { afterEach, describe, expect, it } from 'vitest'
import { APP_LINK, COPY, NO_ACTIONS_NOTE, fitReply, redactContactDetails, refusalReply, renderAnswer } from '@/lib/waAssistant/render'
import { MAX_REPLY_CHARS, buildPlatformTextPayload } from '@/lib/whatsapp/platform/sendText'
import { isWaAssistantAgency, waAssistantAgencyIds, waAssistantDailyUsdCap } from '@/lib/flags/waAssistantFlags'
import type { AgentAnswer } from '@/lib/agent/types'

const answer = (over: Partial<AgentAnswer> = {}): AgentAnswer => ({
  headline: 'יש 3 לידים שמחכים למענה',
  claims: [
    { claimClass: 'FACT', text: 'דניאל כהן כתב לפני שעתיים ועדיין לא קיבל מענה', entityEvidence: ['lead:1'] },
    { claimClass: 'OBSERVATION', text: 'זמן המענה הממוצע היום הוא 40 דקות', metricEvidence: ['m'] },
  ],
  unknown: null,
  ...over,
})

describe('redactContactDetails', () => {
  it.each([
    ['+972 54-922-1572', '[מוסתר]'],
    ['0549221572', '[מוסתר]'],
    ['054-922-1572', '[מוסתר]'],
    ['972549221572', '[מוסתר]'],
    ['dana@example.co.il', '[מוסתר]'],
  ])('%s is hidden', (raw, out) => {
    expect(redactContactDetails(`צור קשר: ${raw} היום`)).toBe(`צור קשר: ${out} היום`)
  })
  it.each(['3 לידים', 'ב-20.10.2026', 'בשעה 14:30', 'ליד 12345678'])('keeps ordinary numbers: %s', (s) => {
    expect(redactContactDetails(s)).toBe(s)
  })
})

describe('renderAnswer', () => {
  it('headline, claims as bullets, and the app link', () => {
    const { text, headline } = renderAnswer(answer())
    expect(headline).toBe('יש 3 לידים שמחכים למענה')
    expect(text).toContain('*יש 3 לידים שמחכים למענה*')
    expect(text).toContain('• דניאל כהן כתב לפני שעתיים ועדיין לא קיבל מענה')
    expect(text).toContain(APP_LINK)
  })
  it('redacts a phone number or email that reached a claim', () => {
    const { text } = renderAnswer(answer({ claims: [{ claimClass: 'FACT', text: 'הליד דנה 0541234567 dana@x.com', entityEvidence: ['lead:2'] }] }))
    expect(text).not.toMatch(/0541234567|dana@x\.com/)
  })
  it('caps the claims and the length', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ claimClass: 'FACT' as const, text: `טענה ${i} ${'א'.repeat(200)}`, entityEvidence: ['lead:1'] }))
    const { text } = renderAnswer(answer({ claims: many }))
    expect(text.length).toBeLessThanOrEqual(1600)
    expect((text.match(/•/g) ?? []).length).toBeLessThanOrEqual(6)
  })
  it('a long answer with a proposal keeps NO_ACTIONS_NOTE through the final payload', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ claimClass: 'FACT' as const, text: `טענה ${i} ${'א'.repeat(400)}`, entityEvidence: ['lead:1'] }))
    const { text } = renderAnswer(answer({ claims: many }), { note: NO_ACTIONS_NOTE })
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS)
    expect(text.endsWith(`\n\n${NO_ACTIONS_NOTE}`)).toBe(true)
    const body = buildPlatformTextPayload({ toDigits: '972500000000', body: text }).text.body
    expect(body).toBe(text)
    expect(body.endsWith(NO_ACTIONS_NOTE)).toBe(true)
  })
  it('fitReply cuts only the body, and leaves short text untouched', () => {
    expect(fitReply('קצר', NO_ACTIONS_NOTE)).toBe(`קצר\n\n${NO_ACTIONS_NOTE}`)
    expect(fitReply('קצר')).toBe('קצר')
    const out = fitReply('ב'.repeat(5000), NO_ACTIONS_NOTE)
    expect(out.length).toBe(MAX_REPLY_CHARS)
    expect(out).toContain(`…\n\n${NO_ACTIONS_NOTE}`)
  })
})

describe('fixed copy and refusals', () => {
  it('no fixed reply claims an action was done', () => {
    for (const t of [...Object.values(COPY), NO_ACTIONS_NOTE]) expect(t).not.toMatch(/נוצר|נקבע|בוצע|שלחתי|יצרתי|קבעתי/)
  })
  it('refusals that could confirm an account are silent', () => {
    for (const r of ['agency_not_enabled', 'recipient_not_active', 'ambiguous_number', 'user_not_active']) expect(refusalReply(r)).toBeNull()
    expect(refusalReply('no_product_access')).toBe(COPY.notAvailable)
    expect(refusalReply('sender_limit')).toBe(COPY.senderLimit)
    expect(refusalReply('spend_limit')).toBe(COPY.agencyLimit)
  })
})

describe('waAssistantFlags', () => {
  afterEach(() => {
    delete process.env.WA_ASSISTANT_AGENCY_IDS
    delete process.env.WA_ASSISTANT_DAILY_USD_CAP
  })
  it('absent means nobody; `all` opens nothing; explicit ids only', () => {
    expect(waAssistantAgencyIds()).toEqual([])
    process.env.WA_ASSISTANT_AGENCY_IDS = 'all'
    expect(isWaAssistantAgency(103)).toBe(false)
    process.env.WA_ASSISTANT_AGENCY_IDS = '103, x, 103'
    expect(waAssistantAgencyIds()).toEqual([103])
    expect(isWaAssistantAgency(103)).toBe(true)
    expect(isWaAssistantAgency(158)).toBe(false)
  })
  it('daily cap: default 2, positive numbers only', () => {
    expect(waAssistantDailyUsdCap()).toBe(2)
    process.env.WA_ASSISTANT_DAILY_USD_CAP = '0'
    expect(waAssistantDailyUsdCap()).toBe(2)
    process.env.WA_ASSISTANT_DAILY_USD_CAP = '5.5'
    expect(waAssistantDailyUsdCap()).toBe(5.5)
  })
})
