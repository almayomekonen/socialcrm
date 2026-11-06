import { describe, expect, it } from 'vitest'
import { ID_MASK, isValidIsraeliId, redactIdNumbers } from '@/lib/leads/redactIdNumbers'
import { buildLeadNotesExcerpt } from '@/lib/ai/leadNotesExcerpt'

describe('isValidIsraeliId', () => {
  it('accepts check-digit-valid ids, padded or not', () => {
    expect(isValidIsraeliId('123456782')).toBe(true)
    expect(isValidIsraeliId('000000018')).toBe(true)
    expect(isValidIsraeliId('18')).toBe(false) // too short to be an id at all
  })
  it('rejects ids whose check digit is wrong', () => {
    expect(isValidIsraeliId('123456789')).toBe(false)
  })
})

describe('redactIdNumbers', () => {
  it("masks the lead's own id in any position, even when its check digit is invalid", () => {
    expect(redactIdNumbers('ת"ז 039876541, לחזור אליו', ['039876541'])).toBe(`ת"ז ${ID_MASK}, לחזור אליו`)
  })

  it('masks any other check-digit-valid 9-digit id', () => {
    expect(redactIdNumbers('בן הזוג: 123456782')).toBe(`בן הזוג: ${ID_MASK}`)
  })

  it('leaves ordinary numbers alone: mobile phones, prices, dates, invalid 9-digit runs', () => {
    const text = 'טלפון 0521234567, מחיר 1500 ₪, פגישה 12/11/2026, אסמכתא 123456789'
    expect(redactIdNumbers(text, ['039876541'])).toBe(text)
  })

  it('does not mask a known id that is only part of a longer number', () => {
    expect(redactIdNumbers('חשבון 10398765419', ['039876541'])).toBe('חשבון 10398765419')
  })
})

describe('buildLeadNotesExcerpt', () => {
  it('joins newest-first notes, masks ids and keeps the business content', () => {
    const out = buildLeadNotesExcerpt(['רוצה לדבר שבוע הבא', 'ת"ז 039876541, מעוניין בחבילה הגדולה'], ['039876541'], 400)
    expect(out).toBe(`רוצה לדבר שבוע הבא | ת"ז ${ID_MASK}, מעוניין בחבילה הגדולה`)
  })

  it('is null when there are no notes (never a fallback to another field)', () => {
    expect(buildLeadNotesExcerpt([], ['039876541'], 400)).toBeNull()
    expect(buildLeadNotesExcerpt(['  ', null], [], 400)).toBeNull()
  })

  it('bounds the length', () => {
    expect(buildLeadNotesExcerpt(['א'.repeat(1000)], [], 400)!.length).toBe(400)
  })
})
