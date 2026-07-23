import { describe, it, expect } from 'vitest'
import { failureTextForCategory, mapWhatsappError } from '@/lib/inbox/whatsappErrorCopy'

describe('mapWhatsappError — categories by required action', () => {
  it('24-hour window codes → window_expired', () => {
    expect(mapWhatsappError(131047).category).toBe('window_expired')
    expect(mapWhatsappError(131051).category).toBe('window_expired')
    expect(mapWhatsappError(470).category).toBe('window_expired')
  })
  it('recipient codes → recipient', () => {
    expect(mapWhatsappError(131026).category).toBe('recipient')
    expect(mapWhatsappError(131052).category).toBe('recipient')
  })
  it('account/billing codes → account (owner problem, not rep problem)', () => {
    expect(mapWhatsappError(141006).category).toBe('account')
    expect(mapWhatsappError(131031).category).toBe('account')
    expect(mapWhatsappError(131042).category).toBe('account')
    expect(mapWhatsappError(131049).category).toBe('account')
  })
  it('unknown / missing codes degrade to generic', () => {
    expect(mapWhatsappError(999999).category).toBe('generic')
    expect(mapWhatsappError(null).category).toBe('generic')
    expect(mapWhatsappError(undefined).category).toBe('generic')
  })
})

describe('mapWhatsappError — copy safety', () => {
  const codes = [131047, 131051, 470, 131026, 131052, 141006, 131031, 131042, 131049, 999999]

  it('never leaks a raw Meta code into user-facing text', () => {
    for (const code of codes) {
      // Meta codes are 3+ digits. "24" in the window copy is fine; "131047" is not.
      expect(mapWhatsappError(code).text).not.toMatch(/\d{3,}/)
    }
  })
  it('always returns non-empty Hebrew text', () => {
    for (const code of codes) {
      const { text } = mapWhatsappError(code)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/[֐-׿]/)
    }
  })
  it('never uses forbidden terminology', () => {
    for (const code of codes) {
      expect(mapWhatsappError(code).text).not.toMatch(/לקוח|סוכן/)
    }
  })
  it('the account line does not mention billing or payment', () => {
    const { text } = mapWhatsappError(141006)
    expect(text).not.toMatch(/תשלום|חיוב|אשראי/)
  })
})

describe('failureTextForCategory', () => {
  it('resolves a persisted category key to its copy', () => {
    expect(failureTextForCategory('window_expired')).toBe(mapWhatsappError(131047).text)
    expect(failureTextForCategory('account')).toBe(mapWhatsappError(141006).text)
  })
  it('null/empty → null (nothing to show)', () => {
    expect(failureTextForCategory(null)).toBeNull()
    expect(failureTextForCategory(undefined)).toBeNull()
    expect(failureTextForCategory('')).toBeNull()
  })
  it('an unrecognised stored key degrades to generic, never crashes', () => {
    expect(failureTextForCategory('some_future_key')).toBe(mapWhatsappError(999999).text)
  })
})
