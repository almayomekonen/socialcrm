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
    ['נמאס לי', false],
    ['נמאס לי לאבד לידים', false],
    ['אני מתוסכל', false],
    ['תפסיק לשלוח לי', true],
    ['אל תשלחו לי יותר', true],
    ['אני לא רוצה לקבל הודעות', true],
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
  it('qualified/he does not summarize or use generic filler', () => {
    const t = handoffMessage('qualified', 'he')
    expect(t).toContain('הצוות')
    expect(t).not.toContain('מעולה')
    expect(t).not.toContain('מספיק מידע')
  })
  it('qualified/en', () => expect(handoffMessage('qualified', 'en')).toContain('team'))
  it('hot_signal uses the qualified template', () => expect(handoffMessage('hot_signal', 'en')).toContain('waiting for the team'))
  it('human_request uses the qualified template', () =>
    expect(handoffMessage('human_request', 'he')).toBe('הפנייה שלך ממתינה כעת לטיפול הצוות.'))
  it('max_turns uses the qualified template', () =>
    expect(handoffMessage('max_turns', 'he')).toContain('הצוות'))
  it('uncertain/en', () =>
    expect(handoffMessage('uncertain', 'en')).toBe('Your request is now waiting for the team to pick up.'))

  /**
   * A handoff means the request is durably in the staff inbox, waiting. It does
   * NOT mean anyone has committed to calling, or when. The previous copy
   * promised both — "ויחזור אליך בהקדם" — and nothing in the system backed
   * either, so these assertions now guard the absence of that promise.
   */
  it('promises no callback and no timing, in either language', () => {
    for (const reason of ['qualified', 'uncertain', 'human_request', 'hot_signal', 'max_turns']) {
      for (const lang of ['he', 'en'] as const) {
        const t = handoffMessage(reason, lang)
        expect(t, `${reason}/${lang}`).not.toMatch(/יחזור אלי|יחזרו אלי|בהקדם|תוך \d|get back to you|call you|shortly|within \d/i)
      }
    }
  })
  it('uncertain/he does not say transferring to a rep', () => {
    const t = handoffMessage('uncertain', 'he')
    expect(t).not.toContain('אני מעביר אותך')
    expect(t).toContain('הצוות')
  })
})
