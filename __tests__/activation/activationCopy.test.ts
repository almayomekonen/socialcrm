import { describe, it, expect } from 'vitest'
import { copyFor } from '@/lib/activation/activationCopy'

const ctx = (over = {}) => ({
  pages: [],
  selectedPageId: null,
  connectedPageName: 'Salon Dana',
  errorReason: null,
  ...over,
})

describe('activation copy — temporal truth', () => {
  it('pre-auth (waiting) states the outcome CONDITIONALLY, never as already true', () => {
    const c = copyFor('waitingForActivation', ctx({ connectedPageName: null }))
    expect(c.heading).toContain('עם סיום השלב הזה')
    expect(c.heading).not.toContain('מעכשיו')
    expect(c.ctaLabel).toBe('התחל לקבל לידים')
    expect((c.trust ?? []).length).toBeGreaterThan(0)
  })

  it('post-auth (completed) states the outcome as PRESENT-TRUE', () => {
    const c = copyFor('activationCompleted', ctx())
    expect(c.heading).toBe('סביבת העבודה שלך מוכנה.')
    expect(c.body).toContain('מעכשיו')
  })

  it('subscribing never claims success', () => {
    const c = copyFor('subscribingPage', ctx())
    expect(c.heading).not.toContain('מוכנה')
  })

  it('failed offers a retry', () => {
    const c = copyFor('failed', ctx({ errorReason: 'denied' }))
    expect(c.ctaLabel).toBeTruthy()
  })

  it('never contains the false-finish phrase or banned terminology', () => {
    for (const s of ['waitingForActivation', 'activationCompleted', 'subscribingPage', 'failed'] as const) {
      const c = copyFor(s, ctx())
      const all = [c.heading, c.body, c.ctaLabel, c.instruction, c.secondary, ...(c.trust ?? [])]
        .filter(Boolean)
        .join(' ')
      expect(all).not.toContain('החשבון שלך מוכן')
      expect(all).not.toContain('לקוח')
      expect(all).not.toContain('סוכן')
    }
  })
})
