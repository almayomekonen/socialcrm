import { afterEach, describe, expect, it } from 'vitest'
import { descriptionGrounded, statedCheckNumber, statedDocType, statedInstallments, statedPaymentMethod, statedTransferReference } from '@/lib/waAssistant/smartbee/grounding'
import { _setSmartbeePermittedAgencyIdsForTests, isSmartbeeAgency, SMARTBEE_PERMITTED_AGENCY_IDS, smartbeeAgencyIds, smartbeeProductionEnabled } from '@/lib/flags/smartbeeFlags'
import { resolutionPhrase } from '@/lib/waAssistant/smartbee/resolve'

/** What the OWNER said, never what the model filled. Pure. */

describe('document type from the owner words', () => {
  it.each([
    ['תפיק חשבונית מס קבלה ליוסי', 'InvoiceReceipt'],
    ['חשבונית/קבלה ליוסי', 'InvoiceReceipt'],
    ['תוציא חשבונית וקבלה', 'InvoiceReceipt'],
    ['תפיק חשבונית מס ליוסי', 'Invoice'],
    ['תוציא קבלה ליוסי', 'Receipt'],
    ['הקבלה ליוסי', 'Receipt'],
    ['תכין הצעת מחיר', null],
  ])('%s → %s', (text, expected) => expect(statedDocType([text])).toBe(expected))
  it('the newest message that names a type decides', () => expect(statedDocType(['קבלה', 'חשבונית מס'])).toBe('Receipt'))
})

describe('payment method', () => {
  it.each([
    ['שולם במזומן', 'cash'],
    ['שילם באשראי', 'credit_card'],
    ['בכרטיס', 'credit_card'],
    ['שילם בהעברה בנקאית', 'bank_transfer'],
    ["שילם בצ'ק 1234", 'check'],
    ['בשיק', 'check'],
    ['שילם בביט', 'other'],
    ['בפייבוקס', 'other'],
  ])('%s → %s', (text, method) => expect(statedPaymentMethod([text])).toMatchObject({ method }))
  it('bit and paybox keep the owner word as the label', () => {
    expect(statedPaymentMethod(['בביט'])).toEqual({ method: 'other', otherLabel: 'ביט' })
    expect(statedPaymentMethod(['בפייבוקס'])).toEqual({ method: 'other', otherLabel: 'פייבוקס' })
  })
  it('two methods is a question, not a guess', () => expect(statedPaymentMethod(['חצי מזומן וחצי אשראי'])).toBe('ambiguous'))
  it('nothing said → null (the application asks)', () => expect(statedPaymentMethod(['חשבונית ליוסי 1500'])).toBeNull())
})

describe('payment details', () => {
  it('check number only when written', () => {
    expect(statedCheckNumber(["צ'ק מספר 4567"])).toBe('4567')
    expect(statedCheckNumber(['שיק 88'])).toBe('88')
    expect(statedCheckNumber(["בצ'ק"])).toBeNull()
  })
  it('installments', () => {
    expect(statedInstallments(['באשראי ב-3 תשלומים'])).toBe(3)
    expect(statedInstallments(['באשראי'])).toBeNull()
  })
  it('transfer reference', () => expect(statedTransferReference(['העברה, אסמכתא 55512'])).toBe('55512'))
  it('a description must use the owner words', () => {
    expect(descriptionGrounded('צילום חתונה', ['חשבונית על צילום החתונה'])).toBe(true)
    expect(descriptionGrounded('ייעוץ עסקי', ['חשבונית ליוסי 1500'])).toBe(false)
    expect(descriptionGrounded(null, ['x'])).toBe(false)
  })
})

describe('flags: a named agency, never an audience', () => {
  afterEach(() => {
    delete process.env.SMARTBEE_AGENCY_IDS
    delete process.env.SMARTBEE_PRODUCTION_ENABLED
  })
  it('digits only; all / * are ignored; absent = off', () => {
    expect(isSmartbeeAgency(167)).toBe(false)
    process.env.SMARTBEE_AGENCY_IDS = 'all'
    expect(isSmartbeeAgency(167)).toBe(false)
    expect(isSmartbeeAgency(7)).toBe(false)
    process.env.SMARTBEE_AGENCY_IDS = '*, 7x, 167'
    expect(isSmartbeeAgency(7)).toBe(false)
    expect(isSmartbeeAgency(167)).toBe(true)
    expect(isSmartbeeAgency(0)).toBe(false)
  })

  it('PINNED to agency 167: the env can narrow it, never widen it', () => {
    process.env.SMARTBEE_AGENCY_IDS = '103,167,12,23'
    expect(isSmartbeeAgency(167)).toBe(true)
    for (const other of [103, 12, 23, 69, 168]) expect(isSmartbeeAgency(other)).toBe(false)
    expect(smartbeeAgencyIds()).toEqual([167])
    expect(SMARTBEE_PERMITTED_AGENCY_IDS).toEqual([167])
    // A list without 167 turns it off for everyone.
    process.env.SMARTBEE_AGENCY_IDS = '103'
    expect(isSmartbeeAgency(167)).toBe(false)
    expect(smartbeeAgencyIds()).toEqual([])
  })

  it('the pin cannot be changed outside tests', () => {
    const v = process.env.VITEST
    process.env.VITEST = ''
    try {
      expect(() => _setSmartbeePermittedAgencyIdsForTests([1, 2, 3])).toThrow(/only be changed in tests/)
    } finally {
      process.env.VITEST = v
    }
    process.env.SMARTBEE_AGENCY_IDS = '1'
    expect(isSmartbeeAgency(1)).toBe(false)
  })
  it('production is off unless exactly 1', () => {
    expect(smartbeeProductionEnabled()).toBe(false)
    process.env.SMARTBEE_PRODUCTION_ENABLED = 'true'
    expect(smartbeeProductionEnabled()).toBe(false)
    process.env.SMARTBEE_PRODUCTION_ENABLED = '1'
    expect(smartbeeProductionEnabled()).toBe(true)
  })
})

describe('the owner phrase that opens a resolution card', () => {
  it.each([
    ['המסמך קיים', { resolution: 'exists', docIndex: null }],
    ['בדקתי, המסמך קיים מספר 1045', { resolution: 'exists', docIndex: '1045' }],
    ['המסמך הופק, מס׳ 77', { resolution: 'exists', docIndex: '77' }],
    ['המסמך לא קיים', { resolution: 'absent', docIndex: null }],
    ['המסמך לא הופק מספר 5', { resolution: 'absent', docIndex: null }],
    ['המסמך אינו קיים', { resolution: 'absent', docIndex: null }],
  ])('%s', (text, expected) => expect(resolutionPhrase(text)).toEqual(expected))
  it.each(['תפיק קבלה ליוסי', 'האם המסמכים קיימים?', 'מסמכים', 'x'.repeat(200) + ' המסמך קיים'])('not a resolution: %s', (text) => expect(resolutionPhrase(text)).toBeNull())
})
