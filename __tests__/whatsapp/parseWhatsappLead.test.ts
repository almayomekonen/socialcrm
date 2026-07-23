import { describe, it, expect } from 'vitest'
import { parseWhatsappLead } from '@/lib/adapters/whatsappLead'

const FROM = '972537736636'

describe('parseWhatsappLead — lastName is never null (clients.lastName is NOT NULL)', () => {
  it('single-token name "Fasika✨" → firstName kept, lastName safe-defaulted (not null)', () => {
    const r = parseWhatsappLead(FROM, 'Fasika✨')
    expect(r.firstName).toBe('Fasika✨')
    expect(r.lastName).toBe('')
    expect(r.lastName).not.toBeNull()
  })

  it('emoji-only name "🔥" → firstName kept, lastName safe-defaulted', () => {
    const r = parseWhatsappLead(FROM, '🔥')
    expect(r.firstName).toBe('🔥')
    expect(r.lastName).toBe('')
    expect(r.lastName).not.toBeNull()
  })

  it('empty profile name "" → default firstName, lastName safe-defaulted', () => {
    const r = parseWhatsappLead(FROM, '')
    expect(r.firstName).toBe('ליד מוואטסאפ')
    expect(r.lastName).toBe('')
    expect(r.lastName).not.toBeNull()
  })

  it('whitespace-only name → default firstName, lastName safe-defaulted', () => {
    const r = parseWhatsappLead(FROM, '   ')
    expect(r.firstName).toBe('ליד מוואטסאפ')
    expect(r.lastName).toBe('')
    expect(r.lastName).not.toBeNull()
  })

  it('missing profile name (null/undefined) → default firstName, lastName safe-defaulted', () => {
    for (const p of [null, undefined]) {
      const r = parseWhatsappLead(FROM, p)
      expect(r.firstName).toBe('ליד מוואטסאפ')
      expect(r.lastName).toBe('')
      expect(r.lastName).not.toBeNull()
    }
  })
})

describe('parseWhatsappLead — existing first+last behavior is unchanged', () => {
  it('"John Smith" → firstName John, lastName Smith', () => {
    const r = parseWhatsappLead(FROM, 'John Smith')
    expect(r.firstName).toBe('John')
    expect(r.lastName).toBe('Smith')
  })

  it('three tokens "John Ben Smith" → firstName John, lastName "Ben Smith"', () => {
    const r = parseWhatsappLead(FROM, 'John Ben Smith')
    expect(r.firstName).toBe('John')
    expect(r.lastName).toBe('Ben Smith')
  })
})
