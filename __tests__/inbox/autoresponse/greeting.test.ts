import { describe, expect, it } from 'vitest'
import { decideGreeting, greetingLine, withGreeting } from '@/lib/inbox/autoresponse/greeting'

/**
 * V1 / V2 — the first greeting.
 *
 * These are the decision rules only. Whether a live model actually opens with
 * the line it was handed is a model-response question, covered separately in
 * scripts/e2e/ire-business-profiles.e2e.ts — not here.
 */
describe('greetingLine', () => {
  it('names the business in Hebrew, in the wording product specified', () => {
    expect(greetingLine('קליניקת אורורה', 'he')).toBe('היי, ברוך הבא לקליניקת אורורה 👋')
  })

  it('names the business in English', () => {
    expect(greetingLine('Aurora Clinic', 'en')).toBe('Hi, welcome to Aurora Clinic 👋')
  })

  it('V2 — falls back to a neutral welcome rather than inventing a name', () => {
    for (const missing of [null, '', '   ']) {
      const he = greetingLine(missing, 'he')
      const en = greetingLine(missing, 'en')
      expect(he).toBe('היי, ברוך הבא 👋')
      expect(en).toBe('Hi, welcome 👋')
      // No placeholder, no generic stand-in, nothing that reads as a broken template.
      for (const text of [he, en]) {
        expect(text).not.toMatch(/\(|\)|\{|\}|undefined|null/)
        expect(text).not.toMatch(/העסק שלנו|our business|the business/i)
      }
    }
  })

  it('carries exactly one emoji', () => {
    const matches = greetingLine('מוסך אלון', 'he').match(/\p{Extended_Pictographic}/gu) ?? []
    expect(matches).toHaveLength(1)
  })
})

describe('decideGreeting', () => {
  const base = { businessName: 'קליניקת אורורה', lang: 'he' as const, aiState: 'new' }

  it('greets on the first agent message', () => {
    const d = decideGreeting({ ...base, hasPriorOutbound: false })
    expect(d.greet).toBe(true)
    expect(d).toHaveProperty('line', 'היי, ברוך הבא לקליניקת אורורה 👋')
  })

  it('V1 — never greets again once anything has been sent', () => {
    const d = decideGreeting({ ...base, hasPriorOutbound: true })
    expect(d.greet).toBe(false)
    expect(d).toHaveProperty('reason', 'already_spoke')
  })

  it('counts a human reply as "we have already spoken"', () => {
    // hasPriorOutbound includes human messages: a rep who answered first means
    // the agent must not open with a corporate welcome afterwards.
    expect(decideGreeting({ ...base, hasPriorOutbound: true }).greet).toBe(false)
  })

  it('does not greet in a lifecycle state that is not a first contact', () => {
    for (const aiState of ['escalated', 'human_active', 'opted_out', 'closed']) {
      const d = decideGreeting({ ...base, hasPriorOutbound: false, aiState })
      expect(d.greet).toBe(false)
      expect(d).toHaveProperty('reason', 'not_first_contact_state')
    }
  })

  it('still greets when the business has no name', () => {
    const d = decideGreeting({ ...base, businessName: null, hasPriorOutbound: false })
    expect(d.greet).toBe(true)
    expect(d).toHaveProperty('line', 'היי, ברוך הבא 👋')
  })

  it('mirrors the language of the incoming message', () => {
    const d = decideGreeting({ ...base, lang: 'en', hasPriorOutbound: false })
    expect(d).toHaveProperty('line', 'Hi, welcome to קליניקת אורורה 👋')
  })

  it('fails closed — anything but an explicit false does not greet', () => {
    expect(decideGreeting({ ...base, hasPriorOutbound: undefined as unknown as boolean }).greet).toBe(false)
  })
})

describe('withGreeting', () => {
  it('prefixes the reply', () => {
    expect(withGreeting('היי 👋', 'במה אפשר לעזור?')).toBe('היי 👋 במה אפשר לעזור?')
  })

  it('is idempotent — a reply that already opens with the line is untouched', () => {
    const once = withGreeting('היי 👋', 'במה אפשר לעזור?')
    expect(withGreeting('היי 👋', once)).toBe(once)
  })

  it('passes the reply through unchanged when there is no greeting', () => {
    expect(withGreeting(null, 'במה אפשר לעזור?')).toBe('במה אפשר לעזור?')
  })

  it('returns the greeting alone when the reply is empty', () => {
    expect(withGreeting('היי 👋', '   ')).toBe('היי 👋')
  })
})
