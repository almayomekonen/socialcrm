/**
 * Lead Ads form answers — normalising Meta's `field_data` and labelling it.
 *
 * The payload below has the documented shape of a Graph lead node's
 * `field_data`: standard questions under fixed keys, custom questions under a
 * key derived from the owner's own question text, a multiple-choice question
 * with two values, and a field Meta sent empty.
 */
import { describe, expect, it } from 'vitest'
import { displayableFormAnswers, formAnswerLabel, normalizeFormAnswers } from '@/lib/facebook/leadFormAnswers'

export const REALISTIC_FIELD_DATA = [
  { name: 'full_name', values: ['דוד כהן'] },
  { name: 'phone_number', values: ['+972501234567'] },
  { name: 'email', values: ['david@example.com'] },
  { name: 'city', values: ['חיפה'] },
  { name: 'מה_התקציב_שלך?', values: ['5,000–10,000 ₪'] },
  { name: 'אילו_שירותים_מעניינים_אותך?', values: ['צילום', 'וידאו'] },
  { name: 'when_do_you_want_to_start?', values: ['within_a_month'] },
  { name: 'הערות', values: [] },
]

describe('normalizeFormAnswers', () => {
  it('keeps every field, in form order, with every value', () => {
    const answers = normalizeFormAnswers(REALISTIC_FIELD_DATA)
    expect(answers.map((a) => a.key)).toEqual(REALISTIC_FIELD_DATA.map((f) => f.name))
    expect(answers.find((a) => a.key === 'אילו_שירותים_מעניינים_אותך?')?.values).toEqual(['צילום', 'וידאו'])
    expect(answers.find((a) => a.key === 'הערות')?.values).toEqual([])
  })

  it('keeps a repeated key as two entries', () => {
    const answers = normalizeFormAnswers([
      { name: 'phone_number', values: ['0501111111'] },
      { name: 'phone_number', values: ['0502222222'] },
    ])
    expect(answers).toEqual([
      { key: 'phone_number', values: ['0501111111'] },
      { key: 'phone_number', values: ['0502222222'] },
    ])
  })

  it('skips malformed entries instead of failing the lead', () => {
    const answers = normalizeFormAnswers([null, 7, { values: ['x'] }, { name: '   ', values: ['x'] }, { name: 'ok', values: 'nope' }])
    expect(answers).toEqual([{ key: 'ok', values: [] }])
    expect(normalizeFormAnswers(undefined)).toEqual([])
    expect(normalizeFormAnswers({ name: 'x' })).toEqual([])
  })

  it('keeps numbers and booleans as text, drops objects and blanks', () => {
    expect(normalizeFormAnswers([{ name: 'n', values: [5, true, { a: 1 }, '  ', 'ok'] }])).toEqual([
      { key: 'n', values: ['5', 'true', 'ok'] },
    ])
  })

  it('bounds everything: 50 fields, 20 values, 1000-char answers, 200-char keys', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `q${i}`, values: ['a'] }))
    expect(normalizeFormAnswers(many)).toHaveLength(50)
    const [big] = normalizeFormAnswers([
      { name: 'k'.repeat(500), values: [...Array.from({ length: 30 }, () => 'v'), 'x'.repeat(5000)] },
    ])
    expect(big.key).toHaveLength(200)
    expect(big.values).toHaveLength(20)
    const [long] = normalizeFormAnswers([{ name: 'k', values: ['x'.repeat(5000)] }])
    expect(long.values[0]).toHaveLength(1000)
  })

  it('strips control and bidi-override characters from answers', () => {
    expect(normalizeFormAnswers([{ name: 'k', values: ['a‮b\u0000c'] }])).toEqual([{ key: 'k', values: ['abc'] }])
  })
})

describe('what the owner sees', () => {
  it('hides only the contact details the lead already shows', () => {
    const shown = displayableFormAnswers(normalizeFormAnswers(REALISTIC_FIELD_DATA)).map((a) => a.key)
    expect(shown).toEqual(['city', 'מה_התקציב_שלך?', 'אילו_שירותים_מעניינים_אותך?', 'when_do_you_want_to_start?', 'הערות'])
  })

  it('labels standard questions in Hebrew and custom ones as written', () => {
    expect(formAnswerLabel('city')).toBe('עיר')
    expect(formAnswerLabel('מה_התקציב_שלך?')).toBe('מה התקציב שלך?')
    expect(formAnswerLabel('when_do_you_want_to_start?')).toBe('when do you want to start?')
  })
})
