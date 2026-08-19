import { describe, expect, it } from 'vitest'
import { classifyResponseProfile } from '@/lib/inbox/autoresponse/responseProfile'

describe('classifyResponseProfile', () => {
  it('היי מה קורה? → casual / he / short / vocative null', () => {
    const p = classifyResponseProfile({ lastInbound: 'היי מה קורה?', recentCustomerTexts: ['היי מה קורה?'] })
    expect(p.tone).toBe('casual')
    expect(p.language).toBe('he')
    expect(p.customerStyle).toBe('short')
    expect(p.vocative).toBeNull()
  })

  it('היי אחי מה קורה? → casual / he / vocative אחי', () => {
    const p = classifyResponseProfile({
      lastInbound: 'היי אחי מה קורה?',
      recentCustomerTexts: ['היי אחי מה קורה?'],
    })
    expect(p.tone).toBe('casual')
    expect(p.language).toBe('he')
    expect(p.vocative).toBe('אחי')
  })

  it('שלום, אשמח להבין מה המערכת מציעה → professional / he', () => {
    const p = classifyResponseProfile({
      lastInbound: 'שלום, אשמח להבין מה המערכת מציעה',
      recentCustomerTexts: ['שלום, אשמח להבין מה המערכת מציעה'],
    })
    expect(p.tone).toBe('professional')
    expect(p.language).toBe('he')
    expect(p.vocative).toBeNull()
  })

  it('אני מתוסכל, אני מאבד לידים → frustrated', () => {
    const p = classifyResponseProfile({
      lastInbound: 'אני מתוסכל, אני מאבד לידים',
      recentCustomerTexts: ['אני מתוסכל, אני מאבד לידים'],
    })
    expect(p.emotion).toBe('frustrated')
  })

  it('אני חייב תשובה עכשיו → high urgency', () => {
    const p = classifyResponseProfile({
      lastInbound: 'אני חייב תשובה עכשיו',
      recentCustomerTexts: ['אני חייב תשובה עכשיו'],
    })
    expect(p.urgency).toBe('high')
  })

  it("Hey, what's up? → casual / en", () => {
    const p = classifyResponseProfile({ lastInbound: "Hey, what's up?", recentCustomerTexts: ["Hey, what's up?"] })
    expect(p.language).toBe('en')
    expect(p.tone).toBe('casual')
  })

  it('Hello, I would like to understand your system → professional / en', () => {
    const p = classifyResponseProfile({
      lastInbound: 'Hello, I would like to understand your system',
      recentCustomerTexts: ['Hello, I would like to understand your system'],
    })
    expect(p.tone).toBe('professional')
    expect(p.language).toBe('en')
  })

  it('Hi אחי, כמה עולה? → he / casual / vocative אחי', () => {
    const p = classifyResponseProfile({
      lastInbound: 'Hi אחי, כמה עולה?',
      recentCustomerTexts: ['Hi אחי, כמה עולה?'],
    })
    expect(p.language).toBe('he')
    expect(p.tone).toBe('casual')
    expect(p.vocative).toBe('אחי')
  })

  it('historical casual + current professional keeps establishedTone casual', () => {
    const p = classifyResponseProfile({
      lastInbound: 'אני רוצה לקבל הצעת מחיר מסודרת',
      recentCustomerTexts: ['היי אחי', 'אחלה אחי', 'אני רוצה לקבל הצעת מחיר מסודרת'],
    })
    expect(p.tone).toBe('professional')
    expect(p.establishedTone).toBe('casual')
    expect(p.vocative).toBeNull()
  })

  it('מה המחיר? → neutral / vocative null', () => {
    const p = classifyResponseProfile({ lastInbound: 'מה המחיר?', recentCustomerTexts: ['מה המחיר?'] })
    expect(p.tone).toBe('neutral')
    expect(p.vocative).toBeNull()
  })

  it('תודה אחי → casual / positive / vocative אחי', () => {
    const p = classifyResponseProfile({ lastInbound: 'תודה אחי', recentCustomerTexts: ['תודה אחי'] })
    expect(p.tone).toBe('casual')
    expect(p.emotion).toBe('positive')
    expect(p.vocative).toBe('אחי')
  })

  it('לא הבנתי מה הכוונה → confused', () => {
    const p = classifyResponseProfile({
      lastInbound: 'לא הבנתי מה הכוונה',
      recentCustomerTexts: ['לא הבנתי מה הכוונה'],
    })
    expect(p.emotion).toBe('confused')
  })

  it('detailed multi-sentence inbound → detailed', () => {
    const lastInbound =
      'יש לי עסק קטן ואני מקבל פניות כל היום. אני לא מספיק לחזור לכולם בזמן. צריך מערכת שתרכז את זה במקום אחד.'
    const p = classifyResponseProfile({ lastInbound, recentCustomerTexts: [lastInbound] })
    expect(p.customerStyle).toBe('detailed')
  })

  it('short inbound → short', () => {
    const p = classifyResponseProfile({ lastInbound: 'מה המחיר?', recentCustomerTexts: ['מה המחיר?'] })
    expect(p.customerStyle).toBe('short')
  })

  it('punctuation/emoji-only input must not throw', () => {
    expect(() => classifyResponseProfile({ lastInbound: '👍', recentCustomerTexts: ['👍'] })).not.toThrow()
    expect(() => classifyResponseProfile({ lastInbound: '...', recentCustomerTexts: ['...'] })).not.toThrow()
    const p = classifyResponseProfile({ lastInbound: '??', recentCustomerTexts: ['??'] })
    expect(p.vocative).toBeNull()
    expect(p.tone).toBe('neutral')
  })

  it('empty string must not throw', () => {
    expect(() => classifyResponseProfile({ lastInbound: '', recentCustomerTexts: [] })).not.toThrow()
    const p = classifyResponseProfile({ lastInbound: '', recentCustomerTexts: [''] })
    expect(p.vocative).toBeNull()
    expect(p.language).toBe('en')
  })

  it('vocative must NEVER be inferred from previous messages', () => {
    const p = classifyResponseProfile({
      lastInbound: 'מה המחיר?',
      recentCustomerTexts: ['היי אחי', 'אחלה אחי', 'מה המחיר?'],
    })
    expect(p.vocative).toBeNull()
    expect(p.establishedTone).toBe('casual')
  })

  it('English-only must never become Hebrew', () => {
    const p = classifyResponseProfile({ lastInbound: "Hey, what's up?", recentCustomerTexts: ["Hey, what's up?"] })
    expect(p.language).toBe('en')
  })

  it('mixed Hebrew + English must be Hebrew', () => {
    const p = classifyResponseProfile({
      lastInbound: 'Hi אחי, כמה עולה?',
      recentCustomerTexts: ['Hi אחי, כמה עולה?'],
    })
    expect(p.language).toBe('he')
  })

  it('professional current message overrides casual current markers', () => {
    const p = classifyResponseProfile({
      lastInbound: 'שלום אחי, אשמח להבין מה המערכת מציעה',
      recentCustomerTexts: ['שלום אחי, אשמח להבין מה המערכת מציעה'],
    })
    expect(p.tone).toBe('professional')
    expect(p.vocative).toBe('אחי')
  })
})
