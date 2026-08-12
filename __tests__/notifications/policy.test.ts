import { describe, expect, it } from 'vitest'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import { IN_APP_ONLY_CAPABILITIES, resolveChannels } from '@/lib/notifications/policy'
import { IDLE_WINDOW_MS, ONLINE_WINDOW_MS, classifyPresence } from '@/lib/notifications/presence'
import { NOTIFICATION_TYPES, PRESENCE_STATES, type Capabilities, type Presence } from '@/lib/notifications/types'

/**
 * Channel policy and presence — spec §7.2, §15.1, §19, §22.1.
 */

const ALL: Capabilities = { in_app: true, toast: true, web_push: true, email: true }
const policyFor = (type: (typeof NOTIFICATION_TYPES)[number]) => NOTIFICATION_REGISTRY[type].channels

describe('the §19 matrix', () => {
  it('every type reaches IN_APP in every presence state — the bell never misses', () => {
    // This is what makes the record of truth complete: whatever else is chosen,
    // there is always a row the user can find later.
    for (const type of NOTIFICATION_TYPES) {
      for (const presence of PRESENCE_STATES) {
        expect(policyFor(type)[presence], `${type}/${presence}`).toContain('in_app')
      }
    }
  })

  it('never toasts a user who is not there', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(policyFor(type).idle).not.toContain('toast')
      expect(policyFor(type).offline).not.toContain('toast')
    }
  })

  it('never pushes a user who is watching the screen', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(policyFor(type).online, `${type} pushes while online`).not.toContain('web_push')
    }
  })

  it('only the three genuinely-critical types email by default (§16)', () => {
    const emailing = NOTIFICATION_TYPES.filter((t) => PRESENCE_STATES.some((p) => policyFor(t)[p].includes('email')))
    expect([...emailing].sort()).toEqual(['integration.disconnected', 'integration.ingestion_failed', 'sla.breached'])
  })

  it('quiet, low-priority state changes never leave the app', () => {
    for (const type of ['lead.status_changed', 'lead.activity'] as const) {
      for (const presence of PRESENCE_STATES) {
        expect(policyFor(type)[presence]).toEqual(['in_app'])
      }
    }
  })
})

describe('capability intersection (§15.1)', () => {
  const resolve = (over: Partial<Parameters<typeof resolveChannels>[0]> = {}) =>
    resolveChannels({
      policy: policyFor('lead.created'),
      presence: 'online',
      capabilities: ALL,
      priority: 'medium',
      ...over,
    })

  it('keeps what policy asked for when everything is available', () => {
    expect(resolve()).toEqual(['in_app', 'toast'])
  })

  it('drops a channel the user cannot receive — no branch, no special case', () => {
    expect(resolve({ capabilities: { ...ALL, toast: false } })).toEqual(['in_app'])
  })

  it('drops a channel the user turned off', () => {
    expect(resolve({ preferences: { toast: false } })).toEqual(['in_app'])
  })

  it('treats an absent preference as allowed — no configuration required (§17)', () => {
    expect(resolve({ preferences: {} })).toEqual(['in_app', 'toast'])
    expect(resolve({ preferences: undefined })).toEqual(['in_app', 'toast'])
  })

  it('preferences can only ever subtract, never add a channel policy did not select', () => {
    const result = resolveChannels({
      policy: policyFor('lead.activity'), // in-app only in every state
      presence: 'offline',
      capabilities: ALL,
      priority: 'info',
      preferences: { web_push: true, email: true, toast: true },
    })
    expect(result).toEqual(['in_app'])
  })

  it('a CRITICAL notification cannot have its in-app row switched off (§17)', () => {
    const result = resolveChannels({
      policy: policyFor('integration.disconnected'),
      presence: 'offline',
      capabilities: ALL,
      priority: 'critical',
      preferences: { in_app: false, web_push: false, email: false },
    })
    // The row survives; the interruptions the user silenced do not.
    expect(result).toEqual(['in_app'])
  })

  it('a non-critical in-app channel IS user-controllable', () => {
    const result = resolveChannels({
      policy: policyFor('lead.activity'),
      presence: 'online',
      capabilities: ALL,
      priority: 'info',
      preferences: { in_app: false },
    })
    expect(result).toEqual([])
  })

  it('P1 capabilities reduce every type to in-app alone', () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const presence of PRESENCE_STATES) {
        const result = resolveChannels({
          policy: policyFor(type),
          presence,
          capabilities: IN_APP_ONLY_CAPABILITIES,
          priority: NOTIFICATION_REGISTRY[type].basePriority,
        })
        expect(result, `${type}/${presence}`).toEqual(['in_app'])
      }
    }
  })

  it('preserves policy order, so dispatch is deterministic', () => {
    expect(resolve({ presence: 'offline' })).toEqual(['in_app', 'web_push'])
  })
})

describe('presence classification (§7.2)', () => {
  const now = new Date('2026-08-11T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  it('a user with no row is offline — the safe reading', () => {
    expect(classifyPresence(null, now)).toBe('offline')
    expect(classifyPresence(undefined, now)).toBe('offline')
  })

  it('a fresh visible poll is online', () => {
    expect(classifyPresence({ lastSeenAt: ago(5_000), lastSeenVisible: true }, now)).toBe('online')
  })

  it('a fresh poll from a HIDDEN tab is idle, not online', () => {
    // At the desk, not looking — which is exactly when a push is appropriate.
    expect(classifyPresence({ lastSeenAt: ago(5_000), lastSeenVisible: false }, now)).toBe('idle')
  })

  it('goes idle at the online boundary and offline at the idle boundary', () => {
    expect(classifyPresence({ lastSeenAt: ago(ONLINE_WINDOW_MS - 1), lastSeenVisible: true }, now)).toBe('online')
    expect(classifyPresence({ lastSeenAt: ago(ONLINE_WINDOW_MS), lastSeenVisible: true }, now)).toBe('idle')
    expect(classifyPresence({ lastSeenAt: ago(IDLE_WINDOW_MS - 1), lastSeenVisible: true }, now)).toBe('idle')
    expect(classifyPresence({ lastSeenAt: ago(IDLE_WINDOW_MS), lastSeenVisible: true }, now)).toBe('offline')
  })

  it('treats a future timestamp as fresh rather than falling through to offline', () => {
    // Clock skew between the app server and the database must not be read as
    // "away", which would start pushing at people sitting in front of the app.
    expect(classifyPresence({ lastSeenAt: ago(-60_000), lastSeenVisible: true }, now)).toBe('online')
  })

  it('returns only declared states', () => {
    const states: Presence[] = [
      classifyPresence(null, now),
      classifyPresence({ lastSeenAt: ago(1), lastSeenVisible: true }, now),
      classifyPresence({ lastSeenAt: ago(120_000), lastSeenVisible: true }, now),
    ]
    for (const s of states) expect(PRESENCE_STATES).toContain(s)
  })
})
