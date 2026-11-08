import { describe, it, expect } from 'vitest'
import {
  cardStorageConsent,
  CARD_STORAGE_CONSENT_LABEL,
  CARD_STORAGE_CONSENT_VERSION,
  CREDIT_CARD_STORAGE_CONSENT_LABEL,
  CREDIT_CARD_STORAGE_CONSENT_VERSION,
} from '@/lib/payments/cardTrial/terms'

describe('card-storage consent on the credit purchase path', () => {
  it('states each of the four promises', () => {
    expect(CREDIT_CARD_STORAGE_CONSENT_LABEL).toContain('לצורך רכישות עתידיות')
    expect(CREDIT_CARD_STORAGE_CONSENT_LABEL).toContain('כל רכישה של חבילת קרדיטים תתבצע רק לאחר אישור מפורש שלי')
    expect(CREDIT_CARD_STORAGE_CONSENT_LABEL).toContain('הסכום שיוצג לי הוא הסכום שיחויב')
    expect(CREDIT_CARD_STORAGE_CONSENT_LABEL).toContain('שמירת הכרטיס אינה מאשרת חיובים אוטומטיים או חידוש מנוי')
  })

  it('does not promise a future subscription charge', () => {
    expect(CREDIT_CARD_STORAGE_CONSENT_LABEL).not.toContain('עבור המנוי')
  })

  it('has its own version, and wording and version travel together', () => {
    expect(CREDIT_CARD_STORAGE_CONSENT_VERSION).not.toBe(CARD_STORAGE_CONSENT_VERSION)
    expect(cardStorageConsent('credits')).toEqual({ label: CREDIT_CARD_STORAGE_CONSENT_LABEL, version: CREDIT_CARD_STORAGE_CONSENT_VERSION })
  })

  it('leaves the subscription path exactly as it was', () => {
    expect(cardStorageConsent()).toEqual({ label: CARD_STORAGE_CONSENT_LABEL, version: '2026-09-16' })
  })
})
