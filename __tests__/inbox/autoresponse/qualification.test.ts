import { describe, it, expect } from 'vitest'
import { mergeCognition, mergeQualification, requiredComplete } from '@/lib/inbox/autoresponse/qualification'

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
  it('cognition does not affect required completeness', () => {
    expect(requiredComplete({ name: 'ד', need: 'n', urgency: 'u', cognition: { pain: 'x' } }, required)).toBe(true)
  })
})

describe('mergeCognition (fill-empty facts, latest objective)', () => {
  it('fills empty cognition facts and keeps lastObjective', () => {
    expect(mergeCognition(undefined, { lastObjective: 'understand_pain', pain: 'שוכחת לחזור' })).toEqual({
      lastObjective: 'understand_pain',
      pain: 'שוכחת לחזור',
    })
  })
  it('never overwrites a known fact with a later value', () => {
    expect(
      mergeCognition({ pain: 'שוכחת לחזור' }, { pain: 'משהו אחר', impact: 'לקוחה הולכת' }),
    ).toEqual({ pain: 'שוכחת לחזור', impact: 'לקוחה הולכת' })
  })
  it('ignores null/blank incoming facts', () => {
    expect(mergeCognition({ pain: 'שוכחת' }, { pain: '  ', impact: undefined })).toEqual({ pain: 'שוכחת' })
  })
  it('advances lastObjective to the latest decision', () => {
    expect(mergeCognition({ lastObjective: 'understand_pain', pain: 'x' }, { lastObjective: 'understand_impact' })).toEqual({
      lastObjective: 'understand_impact',
      pain: 'x',
    })
  })
  it('mergeQualification persists nested cognition without treating it as a CRM field', () => {
    const merged = mergeQualification({ need: 'ניהול לקוחות' }, { cognition: { lastObjective: 'understand_pain', pain: 'שוכחת' } })
    expect(merged.need).toBe('ניהול לקוחות')
    expect(merged.cognition).toEqual({ lastObjective: 'understand_pain', pain: 'שוכחת' })
    expect(merged).not.toHaveProperty('pain')
  })
})
