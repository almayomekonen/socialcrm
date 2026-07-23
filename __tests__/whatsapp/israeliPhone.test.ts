import { describe, it, expect } from 'vitest'
import { IL_COUNTRY_CODE, toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'

describe('toIsraeliWhatsappRecipient — normalizes validated Israeli locals', () => {
  it('valid 10-digit Israeli local (leading 0, service digit) → E.164 with 972', () => {
    expect(toIsraeliWhatsappRecipient('0537736636')).toBe('972537736636')
  })
  it('strips punctuation/spaces, then matches the local pattern', () => {
    expect(toIsraeliWhatsappRecipient('053-773 6636')).toBe('972537736636')
  })
})

describe('toIsraeliWhatsappRecipient — passes everything else through unchanged', () => {
  it('already E.164 (972…) → unchanged', () => {
    expect(toIsraeliWhatsappRecipient('972535317356')).toBe('972535317356')
    expect(toIsraeliWhatsappRecipient('+972-53-773-6636')).toBe('972537736636')
  })
  it('non-Israeli international number (no leading 0) → unchanged', () => {
    expect(toIsraeliWhatsappRecipient('15551234567')).toBe('15551234567')
  })
  it('does NOT rewrite arbitrary strings that merely begin with 0', () => {
    expect(toIsraeliWhatsappRecipient('0123')).toBe('0123') // too short
    expect(toIsraeliWhatsappRecipient('037736636')).toBe('037736636') // 9 digits
    expect(toIsraeliWhatsappRecipient('0037736636')).toBe('0037736636') // service digit 0
    expect(toIsraeliWhatsappRecipient('0137736636')).toBe('0137736636') // service digit 1
    expect(toIsraeliWhatsappRecipient('05377366360')).toBe('05377366360') // 11 digits
  })
  it('bare number without leading 0 → unchanged', () => {
    expect(toIsraeliWhatsappRecipient('537736636')).toBe('537736636')
  })
  it('empty / non-digit input → empty string', () => {
    expect(toIsraeliWhatsappRecipient('')).toBe('')
    expect(toIsraeliWhatsappRecipient('abc')).toBe('')
  })
})

describe('IL_COUNTRY_CODE', () => {
  it('is the Israeli country code and is what local numbers get prefixed with', () => {
    expect(IL_COUNTRY_CODE).toBe('972')
    expect(toIsraeliWhatsappRecipient('0537736636').startsWith(IL_COUNTRY_CODE)).toBe(true)
  })
})

describe('toIsraeliWhatsappRecipient — idempotency', () => {
  it('normalize(normalize(x)) === normalize(x) for representative inputs', () => {
    for (const x of ['0537736636', '972535317356', '+972-53-773-6636', '15551234567', '0123', '037736636', '0037736636', '537736636', '']) {
      const once = toIsraeliWhatsappRecipient(x)
      const twice = toIsraeliWhatsappRecipient(once)
      expect(twice).toBe(once)
    }
  })
})
