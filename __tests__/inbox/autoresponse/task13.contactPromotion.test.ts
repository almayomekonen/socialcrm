/**
 * Task 13 — Contact → Lead promotion (groups C + D).
 *
 * Promotion is a deterministic classifier decision on the CURRENT inbound only.
 * No second LLM. "Can the AI respond?" and "should this Contact become a Lead?"
 * are separate questions: a greeting may get an answer and stay a Contact.
 */
import { describe, expect, it } from 'vitest'
import { shouldPromoteContactToLead } from '@/lib/inbox/autoresponse/contactLeadPromotion'

describe('Task 13 C — business intent promotes a Contact', () => {
  const PROMOTE = [
    'מה המחיר?',
    'איך מתחברים לוואטסאפ?',
    'אני צריך מערכת ל-5 אנשי מכירות',
    'יש לי עסק ואני מאבד לידים',
    'אני צריך עזרה',
    'לא הבנתי איך זה עובד',
    'אני רוצה להתחיל',
    'זה מתאים לעסק שלי?',
    'אפשר לדבר עם נציג?',
  ]

  it.each(PROMOTE)('promotes on business intent: %s', (text) => {
    expect(shouldPromoteContactToLead(text)).toBe(true)
  })
})

describe('Task 13 C — social / parking inbound never promotes', () => {
  const KEEP_CONTACT = [
    'היי',
    'שלום',
    'היי שלום',
    'מה נשמע',
    'תודה',
    'סבבה',
    'רגע',
    'אני אחשוב על זה',
    'נדבר מחר',
    'לילה טוב',
    '👍',
    '😂',
    'STOP',
  ]

  it.each(KEEP_CONTACT)('stays a Contact: %s', (text) => {
    expect(shouldPromoteContactToLead(text)).toBe(false)
  })

  it('empty / whitespace never promotes', () => {
    expect(shouldPromoteContactToLead('')).toBe(false)
    expect(shouldPromoteContactToLead('   ')).toBe(false)
  })
})

describe('Task 13 D — a social prefix does not swallow real intent', () => {
  const COMPOUNDS = [
    'תודה על הזמן, מה המחיר?',
    'רגע, יש לי שאלה',
    'אני אחשוב על זה, אבל איך מתחברים?',
  ]

  it.each(COMPOUNDS)('promotes on the compound: %s', (text) => {
    expect(shouldPromoteContactToLead(text)).toBe(true)
  })

  it('the same social prefixes alone still do not promote', () => {
    expect(shouldPromoteContactToLead('תודה על הזמן')).toBe(false)
    expect(shouldPromoteContactToLead('רגע')).toBe(false)
    expect(shouldPromoteContactToLead('אני אחשוב על זה')).toBe(false)
  })
})

describe('Task 13 — opt-out is never a promotion', () => {
  it.each(['STOP', 'תפסיק', 'אל תשלחו לי הודעות'])('opt-out stays a Contact: %s', (text) => {
    expect(shouldPromoteContactToLead(text)).toBe(false)
  })
})
