import { describe, it, expect } from 'vitest'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'

describe('email automation registry', () => {
  it('has unique keys', () => {
    const keys = AUTOMATIONS.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every entry is well-formed', () => {
    for (const a of AUTOMATIONS) {
      expect(a.key).toBeTruthy()
      expect(typeof a.subject).toBe('function')
      expect(typeof a.template).toBe('function')
      expect(['transactional', 'lifecycle']).toContain(a.category)
      expect(['highest', 'high', 'medium', 'low']).toContain(a.priority)
      expect(typeof a.enabled).toBe('boolean')
      if (a.trigger === 'scheduled') expect(typeof a.audience).toBe('function')
      if (a.trigger === 'event') expect(a.event).toBeTruthy()
    }
  })

  it('keeps Welcome on its own (legacy) gate for backward compatibility', () => {
    const welcome = AUTOMATIONS.find((a) => a.key === 'welcome')
    expect(welcome).toBeDefined()
    expect(typeof welcome?.gate).toBe('function') // WELCOME_EMAIL_ENABLED, not the automation-system flag
    // Other automations rely on the default (automation-system) gate.
    for (const a of AUTOMATIONS.filter((x) => x.key !== 'welcome')) {
      expect(a.gate).toBeUndefined()
    }
  })

  it('is welcome + the five state emails + the educational journey drip', () => {
    expect(AUTOMATIONS.map((a) => a.key).sort()).toEqual(
      [
        'educational_journey',
        'facebook_not_connected',
        'first_lead_received',
        'no_activity',
        'trial_ending',
        'welcome',
        'whatsapp_not_connected',
      ].sort(),
    )
  })

  it('the educational journey is a dynamic lifecycle drip that runs last', () => {
    const drip = AUTOMATIONS.find((a) => a.key === 'educational_journey')
    expect(drip).toBeDefined()
    expect(drip?.category).toBe('lifecycle')
    expect(drip?.priority).toBe('low')
    expect(typeof drip?.resolve).toBe('function') // content resolved per recipient
    expect(typeof drip?.audience).toBe('function')
    // Runs after every state-triggered automation (highest order in its tier).
    const maxOrder = Math.max(...AUTOMATIONS.map((a) => a.order ?? 0))
    expect(drip?.order).toBe(maxOrder)
  })
})
