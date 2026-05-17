import { describe, it, expect } from 'vitest'
import { sanitizeTaxId, validateTaxId, TAX_ID_LOOKS_INVALID } from '@/lib/billing/issuer/taxId'

describe('sanitizeTaxId', () => {
  it('trims and strips internal whitespace', () => {
    expect(sanitizeTaxId('  123 456 789  ')).toBe('123456789')
    expect(sanitizeTaxId('\t12\n34\r56')).toBe('123456')
  })

  it('returns empty string for non-strings', () => {
    expect(sanitizeTaxId(null)).toBe('')
    expect(sanitizeTaxId(undefined)).toBe('')
    expect(sanitizeTaxId(123)).toBe('')
  })
})

describe('validateTaxId', () => {
  it('passes for empty input (required-check lives elsewhere)', () => {
    expect(validateTaxId('', 'authorized')).toBe(true)
    expect(validateTaxId('   ', 'authorized')).toBe(true)
  })

  it('rejects letters and symbols', () => {
    expect(validateTaxId('12345678a', 'authorized')).toBe(TAX_ID_LOOKS_INVALID)
    expect(validateTaxId('123-456-789', 'authorized')).toBe(TAX_ID_LOOKS_INVALID)
    expect(validateTaxId('123.456.789', 'authorized')).toBe(TAX_ID_LOOKS_INVALID)
  })

  it('enforces 9 digits for exempt', () => {
    expect(validateTaxId('123456789', 'exempt')).toBe(true)
    expect(validateTaxId('12345678', 'exempt')).toBe(TAX_ID_LOOKS_INVALID)
    expect(validateTaxId('1234567890', 'exempt')).toBe(TAX_ID_LOOKS_INVALID)
  })

  it('enforces 9 digits for authorized', () => {
    expect(validateTaxId('123456789', 'authorized')).toBe(true)
    expect(validateTaxId('12345678', 'authorized')).toBe(TAX_ID_LOOKS_INVALID)
  })

  it('allows 8 or 9 digits for company', () => {
    expect(validateTaxId('12345678', 'company')).toBe(true)
    expect(validateTaxId('123456789', 'company')).toBe(true)
    expect(validateTaxId('1234567', 'company')).toBe(TAX_ID_LOOKS_INVALID)
    expect(validateTaxId('1234567890', 'company')).toBe(TAX_ID_LOOKS_INVALID)
  })

  it('falls back to 8–9 digits when businessType is missing', () => {
    expect(validateTaxId('12345678', null)).toBe(true)
    expect(validateTaxId('123456789', undefined)).toBe(true)
    expect(validateTaxId('1234567', null)).toBe(TAX_ID_LOOKS_INVALID)
  })

  it('sanitizes whitespace before checking', () => {
    expect(validateTaxId(' 123 456 789 ', 'authorized')).toBe(true)
  })
})
