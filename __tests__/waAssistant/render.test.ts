import { afterEach, describe, expect, it } from 'vitest'
import { APP_LINK, COPY, NO_ACTIONS_NOTE, failureReply, fitReply, redactContactDetails, refusalReply, renderAnswer, replyForAnswer } from '@/lib/waAssistant/render'
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

/**
 * replyForAnswer — what the owner receives. The claimless cases replay the model
 * output production actually produced (agent_investigations #41, #44, #47, #50),
 * which the worker used to replace with COPY.noAnswer.
 */
describe('replyForAnswer', () => {
  const plain = (text: string) => {
    expect(text.startsWith('*')).toBe(false)
    expect(text).not.toMatch(/^• /m)
    expect(text).not.toContain(APP_LINK)
  }

  it('"אלוף" → the model\'s own thanks, plain, kept as history (prod #41)', () => {
    const r = replyForAnswer({ headline: 'תודה, בשמחה.', claims: [], unknown: null })
    expect(r).toEqual({ text: 'תודה, בשמחה.', headline: 'תודה, בשמחה.' })
  })

  it.each([
    ['עם איזה ליד לקבוע את הפגישה?'], // prod #44
    ['לכמה דקות לקבוע את הפגישה?'], // prod #47
  ])('a clarifying question is sent as asked, so the next turn can answer it: %s', (q) => {
    const r = replyForAnswer({ headline: q, claims: [], unknown: null })
    expect(r.text).toBe(q)
    expect(r.headline).toBe(q)
  })

  it('an honest "I can\'t tell" is plain: the sentence and its reason, no report chrome', () => {
    const r = replyForAnswer({ headline: 'לא מצאתי ליד בשם שי חדד.', claims: [], unknown: 'אולי הוא רשום בשם אחר.' })
    expect(r.text).toBe('לא מצאתי ליד בשם שי חדד.\n\nאולי הוא רשום בשם אחר.')
    plain(r.text)
  })

  it('an answer with nothing in it is still the fixed no-answer reply, and keeps no history', () => {
    expect(replyForAnswer({ headline: '', claims: [], unknown: null })).toEqual({ text: COPY.noAnswer, headline: null })
    expect(replyForAnswer({ headline: '  ', claims: [], unknown: null }, { note: NO_ACTIONS_NOTE }).text).toBe(`${COPY.noAnswer}\n\n${NO_ACTIONS_NOTE}`)
  })

  it('a plain reply is still redacted and still carries the no-actions note', () => {
    const r = replyForAnswer({ headline: 'הטלפון של דנה הוא 0541234567', claims: [], unknown: null }, { note: NO_ACTIONS_NOTE })
    expect(r.text).not.toContain('0541234567')
    expect(r.text.endsWith(`\n\n${NO_ACTIONS_NOTE}`)).toBe(true)
  })

  it('a product answer is plain and links the screen it cites, not the Agent page', () => {
    const r = replyForAnswer({
      headline: 'את ההכנסות רואים במסך ביצועים.',
      claims: [{ claimClass: 'PRODUCT', text: 'מסך «ביצועים» מציג את סך ההכנסות מעסקאות ששולמו לפי תקופה.', productEvidence: ['deals_and_performance'] }],
      unknown: null,
    })
    plain(r.text)
    expect(r.text).toContain('מסך «ביצועים» מציג')
    expect(r.text.endsWith('במערכת: https://getsocialcrm.com/sum_sales')).toBe(true)
  })

  it('a product claim the headline already says in full is not repeated', () => {
    const r = replyForAnswer({
      headline: 'SocialCRM עולה ₪89 לחודש, בלי תוספת לכל נציג. יש 7 ימי התנסות.',
      claims: [
        { claimClass: 'PRODUCT', text: 'SocialCRM עולה ₪89 לחודש, בלי תוספת לכל נציג.', productEvidence: ['pricing_trial'] },
        { claimClass: 'PRODUCT', text: 'כדי להתחיל נדרש כרטיס אשראי.', productEvidence: ['pricing_trial'] },
      ],
      unknown: null,
    })
    expect(r.text).toBe('SocialCRM עולה ₪89 לחודש, בלי תוספת לכל נציג. יש 7 ימי התנסות.\n\nכדי להתחיל נדרש כרטיס אשראי.\n\nבמערכת: https://getsocialcrm.com/pricing')
  })

  it('a product topic without a screen gets no link', () => {
    const r = replyForAnswer({ headline: 'מה חדש', claims: [{ claimClass: 'PRODUCT', text: 'נוסף ייבוא עסקאות.', productEvidence: ['recent_updates'] }], unknown: null })
    expect(r.text).toBe('מה חדש\n\nנוסף ייבוא עסקאות.')
  })

  it('an answer with business claims is still the report: bold headline, bullets, the app link', () => {
    expect(replyForAnswer(answer())).toEqual(renderAnswer(answer()))
    const mixed = answer({ claims: [...answer().claims, { claimClass: 'PRODUCT', text: 'אפשר לענות מ«שיחות».', productEvidence: ['conversations'] }] })
    expect(replyForAnswer(mixed).text).toContain(APP_LINK)
  })

  it('failureReply keeps the worker\'s fixed copy per reason', () => {
    expect(failureReply('deadline')).toBe(COPY.timeout)
    expect(failureReply('gate_denied')).toBe(COPY.notAvailable)
    expect(failureReply('no_evidence')).toBe(COPY.failed)
  })
})
