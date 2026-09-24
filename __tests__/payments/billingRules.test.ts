import { describe, it, expect } from 'vitest'
import { classifyTokenChargeError } from '@/lib/payments/grow/tokenErrors'
import { nextRetryAt, RETRY_OFFSETS_DAYS, MAX_ATTEMPTS } from '@/lib/payments/charges/retryPolicy'
import { validateCardHolder, normalizeIsraeliMobile } from '@/lib/payments/cardTrial/cardHolder'
import {
  cardTrialTermsLine,
  CARD_TRIAL_AMOUNT,
  CARD_TRIAL_PERIOD,
  TOKEN_SAVE_SUM,
  TOKEN_PROCESS_DESCRIPTION,
  CHARGE_DESCRIPTION,
} from '@/lib/payments/cardTrial/terms'
import * as terms from '@/lib/payments/cardTrial/terms'

describe('classifyTokenChargeError — Grow\'s documented token error table (reference/token)', () => {
  it.each([
    [103, 'כרטיס פג תוקף.', 'final'],
    [103, 'כרטיס גנוב - עסקה לא מאושרת', 'final'],
    [103, 'כרטיס חסום - עסקה לא מאושרת', 'final'],
    [451, 'כרטיס האשראי אינו פעיל/פג תוקף, נא לפנות ללקוח לקבלת כרטיס חדש', 'final'],
    [453, 'חסימת מערכת', 'final'],
    [452, 'חברת האשראי חסמה את הכרטיס, נא לפנות ללקוח לבדיקה', 'final'],
    [103, 'חברת האשראי לא אשרה את העסקה', 'retryable'],
  ] as const)('id %s "%s" → %s', (id, message, expected) => {
    expect(classifyTokenChargeError(id, message)).toBe(expected)
  })

  it('distinguishes id 103 by message, because the table uses 103 for both final and retryable', () => {
    expect(classifyTokenChargeError(103, 'כרטיס פג תוקף.')).toBe('final')
    expect(classifyTokenChargeError(103, 'חברת האשראי לא אשרה את העסקה')).toBe('retryable')
    expect(classifyTokenChargeError(103, 'הודעה אחרת')).toBe('unknown')
  })

  it('tolerates surrounding whitespace and a trailing period', () => {
    expect(classifyTokenChargeError(103, '  כרטיס פג תוקף  ')).toBe('final')
    expect(classifyTokenChargeError(103, 'חסימת מערכת.')).toBe('final')
  })

  it('treats ids 451/452/453 as final even if Grow rewords the message (the table only lists them as final)', () => {
    expect(classifyTokenChargeError(451, '')).toBe('final')
    expect(classifyTokenChargeError(452, 'x')).toBe('final')
    expect(classifyTokenChargeError(453, 'x')).toBe('final')
  })

  it('never guesses outside the table', () => {
    // 140 appears only as a response example, with no finality label.
    expect(classifyTokenChargeError(140, 'לא ניתן לבצע תשלום עם טוקן, קוד מזהה טוקן אינו תקין')).toBe('unknown')
    expect(classifyTokenChargeError(819, 'אין באפשרותך לבצע תשלום כעת')).toBe('unknown')
    expect(classifyTokenChargeError(null, '')).toBe('unknown')
  })
})

describe('nextRetryAt — owner decision: +1, +3, +7 days from the first attempt', () => {
  const first = new Date('2026-10-01T10:00:00Z')

  it('schedules each retry from the FIRST attempt', () => {
    expect(RETRY_OFFSETS_DAYS).toEqual([1, 3, 7])
    expect(nextRetryAt(first, 1)?.toISOString()).toBe('2026-10-02T10:00:00.000Z')
    expect(nextRetryAt(first, 2)?.toISOString()).toBe('2026-10-04T10:00:00.000Z')
    expect(nextRetryAt(first, 3)?.toISOString()).toBe('2026-10-08T10:00:00.000Z')
  })

  it('stops after the fourth attempt and rejects nonsense', () => {
    expect(MAX_ATTEMPTS).toBe(4)
    expect(nextRetryAt(first, 4)).toBeNull()
    expect(nextRetryAt(first, 0)).toBeNull()
  })
})

describe('validateCardHolder — Grow: fullName "at least two names", phone "a valid israeli mobile", no special characters', () => {
  it('accepts two names and an Israeli mobile in common formats', () => {
    expect(validateCardHolder({ fullName: '  ישראל   ישראלי ', phone: '+972-50-123-4567' })).toEqual({
      ok: true,
      fullName: 'ישראל ישראלי',
      phone: '0501234567',
    })
    expect(normalizeIsraeliMobile('050 123 4567')).toBe('0501234567')
  })

  it('turns hyphens and apostrophes into spaces', () => {
    expect(validateCardHolder({ fullName: 'דנה בן-דוד', phone: '0521234567' })).toEqual({ ok: true, fullName: 'דנה בן דוד', phone: '0521234567' })
  })

  it('refuses a single name, and digits in a name', () => {
    expect(validateCardHolder({ fullName: 'ישראל', phone: '0501234567' })).toMatchObject({ ok: false, field: 'fullName' })
    expect(validateCardHolder({ fullName: 'John 2Smith', phone: '0501234567' })).toMatchObject({ ok: false, field: 'fullName' })
  })

  it('refuses a landline or a short number', () => {
    expect(validateCardHolder({ fullName: 'John Smith', phone: '031234567' })).toMatchObject({ ok: false, field: 'phone' })
    expect(validateCardHolder({ fullName: 'John Smith', phone: '05012' })).toMatchObject({ ok: false, field: 'phone' })
  })
})

describe('terms — documented or owner-decided constants only', () => {
  it('carries the owner decision: monthly ₪89 and the no-charge cancellation promise', () => {
    expect(CARD_TRIAL_AMOUNT).toBe(89)
    expect(CARD_TRIAL_PERIOD).toBe('monthly')
    expect(cardTrialTermsLine()).toContain('₪89')
    expect(cardTrialTermsLine()).toContain('לא יבוצע חיוב')
  })

  it('uses the documented Get Token Only sum', () => {
    expect(TOKEN_SAVE_SUM).toBe(1)
  })

  it('Grow-bound descriptions carry no special characters', () => {
    for (const d of [TOKEN_PROCESS_DESCRIPTION, CHARGE_DESCRIPTION]) expect(d).toMatch(/^[\p{L}\p{N} ]+$/u)
  })

  it('declares the hold only because Grow confirmed it, and still declares nothing else', () => {
    // Was absent while the hold was unestablished. Grow confirmed in writing on
    // 2026-09-17 that a token save is an authorization hold released within 10
    // days, so the customer is now told — see GROW_SUPPORT_CONFIRMATIONS.
    expect('TOKEN_HOLD_NOTICE' in terms).toBe(true)
    expect(terms.TOKEN_HOLD_NOTICE).toContain('10 ימים')

    // Still unestablished: which statusCodes mean "saved" is evidence, and it
    // lives in providerEvidence per environment — never as a constant here.
    expect('TOKEN_SAVE_STATUS_CODES' in terms).toBe(false)
  })
})
