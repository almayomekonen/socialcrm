import { describe, expect, it } from 'vitest'
import { automationSentence, statusLabel, timingPhrase, triggerPhrase } from '@/lib/automations/sentence'
import { AUTOMATION_RECIPES } from '@/lib/automations/recipes'

// "One automation = one sentence": every automation must be legible on its
// card without opening it (spec §3.2 / §11.10).

describe('triggerPhrase', () => {
  it('names the source when the definition filters by one', () => {
    expect(triggerPhrase('lead_created', 'facebook', null)).toBe('כשליד חדש נכנס מפייסבוק')
    expect(triggerPhrase('lead_created', null, null)).toBe('כשליד חדש נכנס')
  })

  it('names the target status for status automations', () => {
    expect(triggerPhrase('status_changed', null, 'closed')).toBe('כשסטטוס הליד משתנה ל"סגור"')
  })

  it('degrades gracefully for an unknown source or status', () => {
    expect(triggerPhrase('lead_created', 'tiktok', null)).toBe('כשליד חדש נכנס מtiktok')
    expect(statusLabel('weird')).toBe('weird')
  })
})

describe('timingPhrase', () => {
  it('reads naturally for presets', () => {
    expect(timingPhrase({ kind: 'preset', preset: 'immediate' })).toBe('מיד')
    expect(timingPhrase({ kind: 'preset', preset: 'one_hour' })).toBe('אחרי שעה')
    expect(timingPhrase({ kind: 'preset', preset: 'one_day' })).toBe('אחרי יום')
  })

  it('inflects custom delays correctly', () => {
    expect(timingPhrase({ kind: 'custom', value: 1, unit: 'hours' })).toBe('אחרי שעה')
    expect(timingPhrase({ kind: 'custom', value: 3, unit: 'hours' })).toBe('אחרי 3 שעות')
    expect(timingPhrase({ kind: 'custom', value: 1, unit: 'days' })).toBe('אחרי יום')
    expect(timingPhrase({ kind: 'custom', value: 3, unit: 'days' })).toBe('אחרי 3 ימים')
  })
})

describe('automationSentence', () => {
  it('reads as one line: trigger, message, timing', () => {
    expect(
      automationSentence({
        trigger: 'lead_created',
        sourceFilter: 'facebook',
        targetStatus: null,
        subject: 'ברוכים הבאים',
        timing: { kind: 'preset', preset: 'immediate' },
      }),
    ).toBe('כשליד חדש נכנס מפייסבוק · שולח "ברוכים הבאים" · מיד')
  })

  it('every shipped recipe produces a readable sentence', () => {
    for (const recipe of AUTOMATION_RECIPES) {
      const s = automationSentence({
        trigger: recipe.trigger.type,
        sourceFilter: recipe.trigger.sourceFilter,
        targetStatus: recipe.trigger.targetStatus,
        subject: recipe.subject,
        timing: recipe.timing,
      })
      expect(s.startsWith('כש'), recipe.key).toBe(true)
      expect(s).toContain('שולח')
      expect(s).not.toContain('undefined')
      expect(s).not.toContain('null')
    }
  })
})
