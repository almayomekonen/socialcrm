import { describe, expect, it } from 'vitest'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { isValidTiming } from '@/lib/automations/timing'
import { getEvent } from '@/lib/automations/catalog/registry'
import { unknownTokens } from '@/lib/automations/variables'

// Catalog integrity guards: the V1 catalog is exactly the four ADR-consistent
// starters, every recipe is a valid single-rule sentence, and all content
// variables come from the closed set.

describe('AUTOMATION_RECIPES — V1 catalog', () => {
  it('ships exactly four starters (the pre-event reminder is excluded per ADR-007)', () => {
    expect(AUTOMATION_RECIPES).toHaveLength(4)
    const keys = AUTOMATION_RECIPES.map((r) => r.key)
    expect(keys).toEqual([
      'welcome_new_lead',
      'webinar_registration_confirmation',
      'deal_closed_thank_you',
      'in_progress_follow_up',
    ])
  })

  it('has unique keys', () => {
    const keys = AUTOMATION_RECIPES.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains no event-date anchor concepts anywhere (ADR-007)', () => {
    const text = JSON.stringify(AUTOMATION_RECIPES)
    expect(text.includes('תאריך האירוע')).toBe(false)
    expect(text.includes('שעת האירוע')).toBe(false)
    expect(text.includes('anchor')).toBe(false)
  })

  it.each(AUTOMATION_RECIPES.map((r) => [r.key, r] as const))('%s is a valid single rule', (_key, r) => {
    expect(getEvent(r.eventKey), r.key).toBeTruthy()
    expect(isValidTiming(r.timing)).toBe(true)
    expect(r.name.trim().length).toBeGreaterThan(0)
    expect(r.description.trim().length).toBeGreaterThan(0)
    expect(r.subject.trim().length).toBeGreaterThan(0)
    expect(r.body.trim().length).toBeGreaterThan(0)
    // Conditions reference only fields the chosen event declares.
    const event = getEvent(r.eventKey)!
    for (const c of r.conditions) {
      expect(event.fields.some((f) => f.key === c.field), `${r.key}: ${c.field}`).toBe(true)
    }
  })

  it.each(AUTOMATION_RECIPES.map((r) => [r.key, r] as const))(
    '%s uses only closed-set variables',
    (_key, r) => {
      expect(unknownTokens(r.subject)).toEqual([])
      expect(unknownTokens(r.body)).toEqual([])
    },
  )

  it('contains no emoji (product voice)', () => {
    const text = AUTOMATION_RECIPES.map((r) => `${r.name} ${r.description} ${r.subject} ${r.body}`).join(' ')
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false)
  })
})
