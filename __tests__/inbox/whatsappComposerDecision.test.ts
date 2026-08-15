import { describe, expect, it } from 'vitest'
import { resolveWhatsappComposerDecision } from '@/lib/inbox/whatsappComposerDecision'

const base = {
  leadId: 9,
  health: 'operational' as const,
  window: 'OPEN' as const,
  templatesEnabled: true,
  hasApprovedTemplates: true,
}

describe('resolveWhatsappComposerDecision — health first, then window', () => {
  it('A — OPEN + operational → text composer', () => {
    const d = resolveWhatsappComposerDecision(base)
    expect(d.kind).toBe('text')
    expect(d.canSendFreeText).toBe(true)
    expect(d.canSendTemplate).toBe(false)
  })

  it('G — restricted + OPEN → blocked, no text', () => {
    const d = resolveWhatsappComposerDecision({ ...base, health: 'restricted' })
    expect(d.kind).toBe('health_blocked')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('H — restricted + CLOSED → blocked, no template workaround', () => {
    const d = resolveWhatsappComposerDecision({ ...base, health: 'restricted', window: 'CLOSED' })
    expect(d.kind).toBe('health_blocked')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('I — disconnected / token / webhook + OPEN → blocked', () => {
    for (const health of ['disconnected', 'token', 'webhook', 'registration_pending'] as const) {
      const d = resolveWhatsappComposerDecision({ ...base, health })
      expect(d.kind).toBe('health_blocked')
      expect(d.canSendFreeText).toBe(false)
      expect(d.canSendTemplate).toBe(false)
    }
  })

  it('J — CLOSED + flag ON + approved template → template picker', () => {
    const d = resolveWhatsappComposerDecision({ ...base, window: 'CLOSED' })
    expect(d.kind).toBe('template')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(true)
  })

  it('K — CLOSED + feature flag OFF → no template picker', () => {
    const d = resolveWhatsappComposerDecision({
      ...base,
      window: 'CLOSED',
      templatesEnabled: false,
      hasApprovedTemplates: true,
    })
    expect(d.kind).toBe('closed_no_template')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('L — CLOSED + no approved templates → explanation, no free-text', () => {
    const d = resolveWhatsappComposerDecision({
      ...base,
      window: 'CLOSED',
      hasApprovedTemplates: false,
    })
    expect(d.kind).toBe('closed_no_template')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('F — UNKNOWN + operational → blocked (fail closed)', () => {
    const d = resolveWhatsappComposerDecision({ ...base, window: 'UNKNOWN' })
    expect(d.kind).toBe('window_unknown')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('Q — leadless conversation remains blocked', () => {
    const d = resolveWhatsappComposerDecision({ ...base, leadId: null })
    expect(d.kind).toBe('leadless')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
  })

  it('inbound_only / unknown health never reach the text or template composer', () => {
    for (const health of ['inbound_only', 'unknown'] as const) {
      expect(resolveWhatsappComposerDecision({ ...base, health }).kind).toBe('health_blocked')
      expect(resolveWhatsappComposerDecision({ ...base, health, window: 'CLOSED' }).canSendTemplate).toBe(false)
    }
  })
})
