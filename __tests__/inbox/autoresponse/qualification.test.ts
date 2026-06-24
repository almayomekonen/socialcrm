import { describe, it, expect } from 'vitest'
import { mergeQualification, requiredComplete } from '@/lib/inbox/autoresponse/qualification'

describe('mergeQualification (fill-empty only)', () => {
  it('fills empty fields from extracted', () => {
    expect(mergeQualification({}, { name: 'דוד', need: 'CRM' })).toEqual({ name: 'דוד', need: 'CRM' })
  })
  it('NEVER overwrites an existing value', () => {
    expect(mergeQualification({ name: 'דוד' }, { name: 'יוסי', need: 'CRM' })).toEqual({ name: 'דוד', need: 'CRM' })
  })
  it('trims whitespace and ignores blank extracted values', () => {
    expect(mergeQualification({}, { name: '  דוד  ', need: '   ' })).toEqual({ name: 'דוד' })
  })
  it('treats empty-string current as fillable', () => {
    expect(mergeQualification({ name: '' }, { name: 'דוד' })).toEqual({ name: 'דוד' })
  })
  it('ignores keys outside the field set', () => {
    expect(mergeQualification({}, { name: 'דוד', hacker: 'x' } as never)).toEqual({ name: 'דוד' })
  })
  it('preserves optional fields already present', () => {
    const cur = { name: 'דוד', budget: '5000' }
    expect(mergeQualification(cur, { urgency: 'גבוהה' })).toEqual({ name: 'דוד', budget: '5000', urgency: 'גבוהה' })
  })
})

describe('requiredComplete', () => {
  const required = ['name', 'need', 'urgency']
  it('true when all required present', () => {
    expect(requiredComplete({ name: 'דוד', need: 'CRM', urgency: 'גבוהה' }, required)).toBe(true)
  })
  it('false when one required missing', () => {
    expect(requiredComplete({ name: 'דוד', need: 'CRM' }, required)).toBe(false)
  })
  it('false when a required field is blank', () => {
    expect(requiredComplete({ name: 'דוד', need: 'CRM', urgency: '  ' }, required)).toBe(false)
  })
  it('optional fields do not affect completeness', () => {
    expect(requiredComplete({ name: 'ד', need: 'n', urgency: 'u' }, required)).toBe(true)
  })
})
