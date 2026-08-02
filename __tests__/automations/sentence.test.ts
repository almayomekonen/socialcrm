import { describe, expect, it } from 'vitest'
import { automationSentence, conditionsPhrase, timingPhrase, triggerPhrase } from '@/lib/automations/sentence'
import { getEvent } from '@/lib/automations/catalog/registry'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'

// B3: the sentence is generated ENTIRELY from catalog metadata. This file no
// longer knows a status, a source or a trigger — if it did, the test could not
// be written without naming one.

const created = getEvent('lead.created')!
const statusChanged = getEvent('lead.status_changed')!

describe('triggerPhrase is the event title, from the catalog', () => {
  it('uses the declared title', () => {
    expect(triggerPhrase(created)).toBe(created.title)
    expect(triggerPhrase(statusChanged)).toBe(statusChanged.title)
  })

  it('degrades honestly for an unknown event', () => {
    expect(triggerPhrase(null)).toBe('אירוע שאינו זמין')
  })
})

describe('conditionsPhrase reads labels and options from the event fields', () => {
  it('renders an enum value using its declared label', () => {
    const phrase = conditionsPhrase(statusChanged, [{ field: 'newStatus', operator: 'is', value: 'closed' }])
    expect(phrase).toBe('הסטטוס החדש הוא "סגור"')
  })

  it('joins several conditions with וגם', () => {
    const phrase = conditionsPhrase(created, [
      { field: 'source', operator: 'contains', value: 'facebook' },
      { field: 'status', operator: 'is', value: 'new' },
    ])
    expect(phrase).toBe('מקור הליד מכיל "facebook" וגם סטטוס הליד הוא "חדש"')
  })

  it('is null when there are no conditions', () => {
    expect(conditionsPhrase(created, [])).toBeNull()
  })
})

describe('timingPhrase', () => {
  it('reads naturally for presets and custom delays', () => {
    expect(timingPhrase({ kind: 'preset', preset: 'immediate' })).toBe('מיד')
    expect(timingPhrase({ kind: 'preset', preset: 'one_hour' })).toBe('אחרי שעה')
    expect(timingPhrase({ kind: 'custom', value: 3, unit: 'days' })).toBe('אחרי 3 ימים')
    expect(timingPhrase({ kind: 'custom', value: 1, unit: 'hours' })).toBe('אחרי שעה')
  })
})

describe('automationSentence', () => {
  it('reads as one line: trigger, conditions, action, timing', () => {
    expect(
      automationSentence({
        event: statusChanged,
        conditions: [{ field: 'newStatus', operator: 'is', value: 'closed' }],
        actionTitle: 'שליחת אימייל',
        subject: 'תודה',
        timing: { kind: 'preset', preset: 'immediate' },
      }),
    ).toBe('סטטוס הליד השתנה · רק אם הסטטוס החדש הוא "סגור" · שליחת אימייל: "תודה" · מיד')
  })

  it('omits the conditions clause entirely when there are none', () => {
    const s = automationSentence({
      event: created,
      conditions: [],
      actionTitle: 'שליחת אימייל',
      subject: 'ברוכים הבאים',
      timing: { kind: 'preset', preset: 'immediate' },
    })
    expect(s).not.toContain('רק אם')
  })

  it('every shipped recipe produces a readable sentence with no leaked keys', () => {
    for (const recipe of AUTOMATION_RECIPES) {
      const s = automationSentence({
        event: getEvent(recipe.eventKey),
        conditions: recipe.conditions,
        actionTitle: 'שליחת אימייל',
        subject: recipe.subject,
        timing: recipe.timing,
      })
      expect(s, recipe.key).not.toContain('undefined')
      expect(s, recipe.key).not.toContain('null')
      expect(s, recipe.key).not.toContain('newStatus')
    }
  })
})
