/**
 * `lead.insight` is ENABLED — and nothing else moved.
 *
 * This type shipped `enabled: false` through Phase 4.4 as the innermost of four
 * independent gates: `notifyEvent` refuses a disabled type at the registry lookup,
 * before entitlement and before any INSERT, so no environment flag alone could
 * deliver an AI-originated notification. Opening it is the single most consequential
 * flag in the subsystem — it is the moment a machine's conclusion can reach a real
 * business owner.
 *
 * These tests pin what the change did and, more importantly, what it did NOT do.
 */
import { describe, it, expect } from 'vitest'
import { NOTIFICATION_REGISTRY, isEmittableType } from '@/lib/notifications/registry'
import type { NotificationType } from '@/lib/notifications/types'

describe('lead.insight is enabled', () => {
  it('the registry entry is enabled', () => {
    expect(NOTIFICATION_REGISTRY['lead.insight'].enabled).toBe(true)
    expect(isEmittableType('lead.insight')).toBe(true)
  })

  it('everything else about the entry is unchanged', () => {
    const def = NOTIFICATION_REGISTRY['lead.insight']
    expect(def.category).toBe('leads')
    expect(def.basePriority).toBe('medium')
    // The SAME rule that bounded the evidence the conclusion rests on.
    expect(def.recipients).toBe('handler_or_admin')
    // In-app + web push. Never a toast (nothing just happened), never email/WhatsApp.
    expect(def.channels).toEqual({
      online: ['in_app'],
      idle: ['in_app', 'web_push'],
      offline: ['in_app', 'web_push'],
    })
  })

  /**
   * care-charter Law 16 / brand-principles §6.1: an insight must never escalate.
   * Repeating yourself more loudly is how a channel loses the credibility that
   * makes it worth having. Enabling delivery must not have smuggled a ladder in.
   */
  it('still has NO escalation ladder', () => {
    expect((NOTIFICATION_REGISTRY['lead.insight'] as Record<string, unknown>).escalation).toBeUndefined()
  })
})

describe('the blast radius is exactly one type', () => {
  /** The two sla.* types are a registry extension point with no emitter. */
  it.each(['sla.approaching', 'sla.breached'] as NotificationType[])('%s remains disabled', (t) => {
    expect(NOTIFICATION_REGISTRY[t].enabled).toBe(false)
    expect(isEmittableType(t)).toBe(false)
  })

  it('exactly two types are disabled, and lead.insight is not one of them', () => {
    const disabled = Object.values(NOTIFICATION_REGISTRY)
      .filter((d) => d.enabled === false)
      .map((d) => d.type)
      .sort()
    expect(disabled).toEqual(['sla.approaching', 'sla.breached'])
  })

  it('every other type keeps the enabled state it already had', () => {
    // 21 types total; all enabled except the two sla.* extension points.
    const total = Object.keys(NOTIFICATION_REGISTRY).length
    const enabled = Object.values(NOTIFICATION_REGISTRY).filter((d) => d.enabled).length
    expect(enabled).toBe(total - 2)
  })
})

/**
 * Enabling the type opens ONE of four gates. The other three are the reason this
 * is a canary and not a broadcast, and they live outside this file — so this
 * asserts they are still consulted, not that they are set.
 */
describe('the three remaining gates are untouched', () => {
  it('delivery still requires the per-agency canary and the kill switch', async () => {
    const flags = await import('@/lib/ai/integration/insightFlags')
    // Absence blocks: unset allowlist ⇒ no agency, whatever the registry says.
    delete process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS
    delete process.env.SIGNAL_INSIGHT_KILL
    expect(flags.isInsightDeliveryEnabled(103)).toBe(false)

    process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS = '103'
    expect(flags.isInsightDeliveryEnabled(103)).toBe(true)
    expect(flags.isInsightDeliveryEnabled(999)).toBe(false)

    // The emergency stop still overrides the allowlist.
    process.env.SIGNAL_INSIGHT_KILL = '1'
    expect(flags.isInsightDeliveryEnabled(103)).toBe(false)

    delete process.env.SIGNAL_INSIGHT_KILL
    delete process.env.SIGNAL_INSIGHT_DELIVER_AGENCY_IDS
  })

  it('the hard daily ceiling is unchanged', async () => {
    const { INSIGHT_DAILY_CAP } = await import('@/lib/ai/integration/insightFlags')
    expect(INSIGHT_DAILY_CAP).toBe(3)
  })
})
