import { describe, it, expect } from 'vitest'
import { detectHotSignal, detectLang, detectOptOut, handoffMessage } from '@/lib/inbox/autoresponse/qualify'

describe('detectHotSignal', () => {
  it.each([
    ['כמה זה עולה?', true],
    ['אני רוצה הצעת מחיר', true],
    ['אפשר דמו?', true],
    ['בא לי לקבוע פגישה', true],
    ['איך מתחילים?', true],
    ['שיחזרו אליי בבקשה', true],
    ['אני רוצה לדבר עם נציג', true],
    ['what is the price?', true],
    ['can I get a demo', true],
    ['how do I start?', true],
    ['can someone call me?', true],
    ['I want to talk to a human', true],
    ['I need a CRM', false],
    ['שלום, אשמח לשמוע פרטים', false],
    ['בנוגע לשיווק', false],
  ])('%s → %s', (text, expected) => {
    expect(detectHotSignal(text)).toBe(expected)
  })
})

describe('detectOptOut', () => {
  it.each([
    ['תפסיק להודיע לי', true],
    ['תורידו אותי מהרשימה', true],
    ['stop', true],
    ['please unsubscribe me', true],
    ['remove me', true],
    ['אשמח לשמוע פרטים', false],
    ['I need a CRM', false],
  ])('%s → %s', (text, expected) => {
    expect(detectOptOut(text)).toBe(expected)
  })
})

describe('detectLang', () => {
  it('Hebrew → he', () => expect(detectLang('שלום, מה שלומך')).toBe('he'))
  it('English → en', () => expect(detectLang('Hello there')).toBe('en'))
  it('mixed with Hebrew → he', () => expect(detectLang('hi שלום')).toBe('he'))
})

describe('handoffMessage (fixed templates, never AI-generated)', () => {
  it('qualified/he', () => expect(handoffMessage('qualified', 'he')).toContain('יש לי מספיק מידע'))
  it('qualified/en', () => expect(handoffMessage('qualified', 'en')).toContain('I have enough information'))
  it('hot_signal uses the qualified template', () => expect(handoffMessage('hot_signal', 'en')).toContain('forwarding your details'))
  it('max_turns uses the qualified template', () => expect(handoffMessage('max_turns', 'he')).toContain('מעביר את הפרטים'))
  it('uncertain/en', () => expect(handoffMessage('uncertain', 'en')).toBe('Let me connect you with a team member who can help.'))
  it('uncertain/he', () => expect(handoffMessage('uncertain', 'he')).toContain('שיוכל לעזור'))
})
