// Toast eligibility — the SERVER's channel-policy decision (spec §13.2).
//
// The point of these tests is that toast eligibility is the existing §19 policy
// matrix being read, not a new rule invented for the client. If a registry entry's
// policy changes, these expectations move with it — which is correct, because the
// registry is the single source of truth.
//
// Runs without a database: `npm run test:notifications`.

import { describe, expect, it } from 'vitest'
import { CLIENT_SURFACE_CAPABILITIES, isToastEligible } from '@/lib/notifications/toastEligibility'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import { IN_APP_ONLY_CAPABILITIES } from '@/lib/notifications/policy'

describe('CLIENT_SURFACE_CAPABILITIES', () => {
  it('enables toast, because an open tab IS the toast surface', () => {
    expect(CLIENT_SURFACE_CAPABILITIES.toast).toBe(true)
    expect(CLIENT_SURFACE_CAPABILITIES.in_app).toBe(true)
  })

  it('leaves push and email false — they are not client surfaces and land in P3', () => {
    expect(CLIENT_SURFACE_CAPABILITIES.web_push).toBe(false)
    expect(CLIENT_SURFACE_CAPABILITIES.email).toBe(false)
  })

  it('is distinct from the worker capabilities, which have no client present', () => {
    expect(IN_APP_ONLY_CAPABILITIES.toast).toBe(false)
  })
})

describe('isToastEligible — presence gates the interruption', () => {
  it('toasts a routine lead arrival while ONLINE', () => {
    expect(isToastEligible({ type: 'lead.created', priority: 'medium', presence: 'online' })).toBe(true)
  })

  it('does NOT toast it while IDLE or OFFLINE — nobody is there to be interrupted', () => {
    expect(isToastEligible({ type: 'lead.created', priority: 'medium', presence: 'idle' })).toBe(false)
    expect(isToastEligible({ type: 'lead.created', priority: 'medium', presence: 'offline' })).toBe(false)
  })

  it('never toasts an IN_APP_ONLY type, in any presence state', () => {
    // lead.status_changed is ambient: it records, it does not interrupt.
    for (const presence of ['online', 'idle', 'offline'] as const) {
      expect(isToastEligible({ type: 'lead.status_changed', priority: 'low', presence })).toBe(false)
    }
  })
})

describe('isToastEligible — fail closed', () => {
  it('returns false for an unknown type', () => {
    expect(isToastEligible({ type: 'not.a.type', priority: 'high', presence: 'online' })).toBe(false)
  })

  it('returns false for a registry entry that is disabled', () => {
    const disabled = Object.values(NOTIFICATION_REGISTRY).find((d) => !d.enabled)
    expect(disabled).toBeDefined()
    expect(isToastEligible({ type: disabled!.type, priority: 'high', presence: 'online' })).toBe(false)
  })

  it('agrees with the registry policy for every enabled type', () => {
    // The invariant, stated once: eligibility online == the type's own policy says
    // toast online. No type may drift into or out of toasting behind the registry.
    for (const def of Object.values(NOTIFICATION_REGISTRY)) {
      if (!def.enabled) continue
      const expected = def.channels.online.includes('toast')
      expect(isToastEligible({ type: def.type, priority: def.basePriority, presence: 'online' })).toBe(expected)
    }
  })
})
