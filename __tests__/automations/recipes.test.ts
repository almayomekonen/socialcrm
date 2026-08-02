import { describe, expect, it } from 'vitest'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'
import { isValidTiming } from '@/lib/automations/timing'
import { TRIGGER_TYPES } from '@/lib/automations/types'
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
    expect(TRIGGER_TYPES).toContain(r.trigger.type)
    expect(isValidTiming(r.timing)).toBe(true)
    expect(r.name.trim().length).toBeGreaterThan(0)
    expect(r.description.trim().length).toBeGreaterThan(0)
    expect(r.subject.trim().length).toBeGreaterThan(0)
    expect(r.body.trim().length).toBeGreaterThan(0)
    // status_changed recipes are premised on a target status; lead_created never is.
    if (r.trigger.type === 'status_changed') expect(r.trigger.targetStatus).toBeTruthy()
    else expect(r.trigger.targetStatus).toBeNull()
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
