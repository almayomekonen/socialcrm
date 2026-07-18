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
      expect(['high', 'normal']).toContain(a.priority)
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

  it('is exactly the six Phase 1 automations', () => {
    expect(AUTOMATIONS.map((a) => a.key).sort()).toEqual(
      [
        'facebook_not_connected',
        'first_lead_received',
        'no_activity',
        'trial_ending',
        'welcome',
        'whatsapp_not_connected',
      ].sort(),
    )
  })
})
