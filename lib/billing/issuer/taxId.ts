import type { BusinessType } from './fields'

export const TAX_ID_LOOKS_INVALID = 'מספר עוסק / ח.פ לא נראה תקין'

export function sanitizeTaxId(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, '')
}

export function validateTaxId(
  value: unknown,
  businessType: BusinessType | null | undefined,
): true | string {
  const cleaned = sanitizeTaxId(value)
  if (cleaned === '') return true
  if (!/^\d+$/.test(cleaned)) return TAX_ID_LOOKS_INVALID

  const len = cleaned.length
  if (businessType === 'company') {
    return len === 8 || len === 9 ? true : TAX_ID_LOOKS_INVALID
  }
  if (businessType === 'exempt' || businessType === 'authorized') {
    return len === 9 ? true : TAX_ID_LOOKS_INVALID
  }
  return len === 8 || len === 9 ? true : TAX_ID_LOOKS_INVALID
}
