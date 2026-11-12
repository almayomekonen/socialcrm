import { describe, expect, it } from 'vitest'
import { statedDocType, statedPaymentMethod, statedVat } from '@/lib/waAssistant/smartbee/grounding'
import { statedDocumentAmount } from '@/lib/waAssistant/smartbee/amount'
import { replyForAnswer } from '@/lib/waAssistant/render'
import type { RequestTurn } from '@/lib/waAssistant/request'

/**
 * Phase 1 (P0) financial correctness: what the OWNER said about amount, payment,
 * type and VAT, read with the question each message answered. Pure. Every case
 * here is one the 2026-11-12 audit named.
 */

/** A request, newest first, as request.ts replays it. `answering` is the question that message answered. */
const turns = (...t: [string, string | null][]): RequestTurn[] => t.map(([text, answering]) => ({ text, answering: answering ? `document_clarify_${answering}` : null }))
const opened = (text: string) => turns([text, null])

describe('amount: the newest explicit amount wins, nothing else is money', () => {
  it('"500" then "לא, 2000" → 2000 only', () => {
    expect(statedDocumentAmount(turns(['לא, 2000', 'amount'], ['תפיק קבלה ליוסי 500 במזומן', null]))).toEqual({ amount: 2000 })
  })
  it.each([
    ['1,500', 1500],
    ['₪1500', 1500],
    ['1500 ש"ח', 1500],
    ['1500 שקל', 1500],
    ['1.5K', 1500],
    ['1.5 אלף', 1500],
    ['2K', 2000],
    ['1,500.50 ₪', 1500.5],
  ])('%s → %s', (text, amount) => expect(statedDocumentAmount(opened(`קבלה ליוסי ${text}`))).toEqual({ amount }))

  it("\"צ'ק 1234\" is a check number, not an amount", () => {
    expect(statedDocumentAmount(opened("תפיק קבלה ליוסי, שולם בצ'ק 1234"))).toBeNull()
    expect(statedDocumentAmount(opened("קבלה ליוסי 800 שקל, צ'ק מספר 1234"))).toEqual({ amount: 800 })
  })
  it.each([
    ['a phone number', 'קבלה ליוסי 0501234567'],
    ['a dashed phone', 'קבלה ליוסי 050-1234567'],
    ['installments', 'קבלה ליוסי באשראי ב-3 תשלומים'],
    ['a percent', 'קבלה ליוסי עם 10% הנחה'],
    ['a reference', 'קבלה ליוסי בהעברה, אסמכתא 55512'],
    ['an ID number', 'קבלה ליוסי ת.ז. 012345678'],
    ['a document number', 'קבלה מספר 1045'],
    ['a date', 'קבלה ליוסי מה-12.11.2026'],
    ['a time', 'קבלה ליוסי, הגיע ב-14:30'],
  ])('%s is not an amount', (_label, text) => expect(statedDocumentAmount(opened(text))).toBeNull())

  it('a bare number answering which lead, the check or the installments is not an amount', () => {
    const before: [string, null] = ['קבלה ליוסי 500 שקל במזומן', null]
    for (const q of ['lead', 'check', 'installments']) expect(statedDocumentAmount(turns(['2', q], before))).toEqual({ amount: 500 })
    // Marked as money, it is the amount even there.
    expect(statedDocumentAmount(turns(['2, וזה 700 שקל', 'lead'], before))).toEqual({ amount: 700 })
  })
  it('two different amounts, none marked as money, is a question', () => {
    expect(statedDocumentAmount(opened('קבלה ליוסי 500 או 700'))).toBe('ambiguous')
    // Exactly one marked as money decides.
    expect(statedDocumentAmount(opened('קבלה ליוסי על 2 שעות צילום, 700 שקל'))).toEqual({ amount: 700 })
  })
  it('"1.500" (thousands or decimals?) is a question; words are never read', () => {
    expect(statedDocumentAmount(opened('קבלה ליוסי 1.500'))).toBe('ambiguous')
    expect(statedDocumentAmount(opened('קבלה ליוסי אלף וחמש מאות'))).toBeNull()
  })
})

describe('payment: only an answer to the payment question or an explicit payment statement', () => {
  it.each([
    ['קבלה על כרטיס להופעה', null],
    ['הסעה והעברה לשדה', null],
    ['שולם במזומן', 'cash'],
    ['באשראי ב-3 תשלומים', 'credit_card'],
    ['שילמו בהעברה בנקאית', 'bank_transfer'],
    ["בצ'ק", 'check'],
  ])('%s → %s', (text, method) => {
    const r = statedPaymentMethod(opened(text))
    expect(r === null ? null : r !== 'ambiguous' && r.method).toBe(method)
  })
  it('"שילמתי בביט" → other, labelled ביט; "בפייבוקס" → פייבוקס', () => {
    expect(statedPaymentMethod(opened('שילמתי בביט'))).toEqual({ method: 'other', otherLabel: 'ביט' })
    expect(statedPaymentMethod(opened('בפייבוקס'))).toEqual({ method: 'other', otherLabel: 'פייבוקס' })
  })
  it('"לא מזומן, אשראי" → credit card; "מזומן ולא אשראי" → cash', () => {
    expect(statedPaymentMethod(opened('לא מזומן, אשראי'))).toEqual({ method: 'credit_card', otherLabel: null })
    expect(statedPaymentMethod(opened('שולם מזומן ולא אשראי'))).toEqual({ method: 'cash', otherLabel: null })
  })
  it('a bare word counts only as the answer to OUR payment question', () => {
    expect(statedPaymentMethod(opened('אשראי'))).toBeNull()
    expect(statedPaymentMethod(turns(['אשראי', 'payment']))).toEqual({ method: 'credit_card', otherLabel: null })
    expect(statedPaymentMethod(turns(['העברה', 'payment']))).toEqual({ method: 'bank_transfer', otherLabel: null })
  })
  it('the newest statement wins; a bare negation states nothing and revives nothing older', () => {
    expect(statedPaymentMethod(turns(['לא, בעצם באשראי', 'vat'], ['קבלה ליוסי 500 שולם במזומן', null]))).toEqual({ method: 'credit_card', otherLabel: null })
    expect(statedPaymentMethod(turns(['לא מזומן', 'vat'], ['קבלה ליוסי 500 שולם במזומן', null]))).toBeNull()
  })
  it('two methods stated is a question', () => {
    expect(statedPaymentMethod(turns(['חצי מזומן וחצי אשראי', 'payment']))).toBe('ambiguous')
  })
})

describe('document type: negation and correction order', () => {
  it.each([
    ['לא חשבונית, קבלה', 'Receipt'],
    ['לא קבלה, חשבונית מס', 'Invoice'],
    ['חשבונית מס קבלה', 'InvoiceReceipt'],
    ['חשבונית/קבלה ליוסי', 'InvoiceReceipt'],
    ['תוציא חשבונית וקבלה', 'InvoiceReceipt'],
    ['לא חשבונית מס קבלה, רק קבלה', 'Receipt'],
    ['תפיק חשבונית מס ליוסי', 'Invoice'],
  ])('%s → %s', (text, type) => expect(statedDocType(opened(text))).toBe(type))
  it('two types that are not one phrase is a question; a bare negation states no type', () => {
    expect(statedDocType(opened('חשבונית מס על הצילום וקבלה על המקדמה'))).toBe('ambiguous')
    expect(statedDocType(turns(['לא קבלה', 'amount'], ['תוציא קבלה ליוסי', null]))).toBeNull()
  })
  it('the newest message that names a type decides', () => {
    expect(statedDocType(turns(['לא, חשבונית מס', 'amount'], ['תוציא קבלה ליוסי', null]))).toBe('Invoice')
  })
})

describe('VAT: typo tolerance only inside the open VAT question', () => {
  it('"כלל" answering the VAT question → including; anywhere else → nothing', () => {
    expect(statedVat(turns(['כלל', 'vat']))).toBe('incl_vat')
    expect(statedVat(opened('חשבונית ליוסי 1000 כלל'))).toBeNull()
    expect(statedVat(turns(['כלל', 'payment']))).toBeNull()
  })
  it.each([
    ['כולל', 'incl_vat'],
    ['כולל מעמ', 'incl_vat'],
    ['כולל מע"מ', 'incl_vat'],
    ["כולל מע'מ", 'incl_vat'],
    ['כן כולל', 'incl_vat'],
    ['לפני', 'excl_vat'],
    ['לפני מע"מ', 'excl_vat'],
    ['פלוס', 'excl_vat'],
    ['פלוס מע"מ', 'excl_vat'],
  ])('answering the VAT question: %s → %s', (text, basis) => expect(statedVat(turns([text, 'vat']))).toBe(basis))
  it('"בלי" answers neither "כולל" nor "לפני": asked again', () => {
    expect(statedVat(turns(['בלי', 'vat']))).toBeNull()
    expect(statedVat(turns(['ללא', 'vat']))).toBeNull()
  })
  it('an explicit sentence still works anywhere', () => {
    expect(statedVat(opened('חשבונית ליוסי 1000 כולל מעמ'))).toBe('incl_vat')
    expect(statedVat(opened('חשבונית ליוסי 1000 לפני מע"מ'))).toBe('excl_vat')
  })
})

describe('one reply never says the same sentence twice', () => {
  const q = 'איזה מסמך להפיק: חשבונית מס, קבלה, או חשבונית מס קבלה?'
  it('a claimless answer whose headline and unknown are the same question sends it once', () => {
    const { text } = replyForAnswer({ headline: q, claims: [], unknown: q } as never)
    expect(text.split(q).length - 1).toBe(1)
  })
  it('a different unknown is still sent', () => {
    const { text } = replyForAnswer({ headline: q, claims: [], unknown: 'לא מצאתי את הליד.' } as never)
    expect(text).toContain('לא מצאתי את הליד.')
  })
})
