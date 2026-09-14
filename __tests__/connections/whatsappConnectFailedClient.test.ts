/**
 * `whatsapp_connect_failed` from the browser — the outcomes the server never sees.
 *
 * Production had 16 `whatsapp_connect_started` from 8 external agencies since
 * 2026-09-01 and ZERO recorded outcomes, success or failure. This event is what
 * makes the next one visible. The allowlist must let exactly it through, with a
 * fixed reason vocabulary, and nothing the client sends may reach `stage` or
 * `inApp`: both are stamped server-side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tracked: [] as { event: string; props?: Record<string, unknown> }[],
  user: { id: 5, agencyId: 42 } as { id: number; agencyId: number } | null,
  inApp: null as 'instagram' | 'facebook' | null,
}))

vi.mock('@/lib/requireUser', () => ({
  requireBasicCrmAccess: async () => {
    if (!h.user) throw new Error('unauthorized')
    return h.user
  },
}))
vi.mock('@/lib/analytics/track', () => ({
  track: vi.fn(async (a: never) => {
    h.tracked.push(a)
  }),
}))
vi.mock('@/lib/device', () => ({ getInAppBrowser: async () => h.inApp }))

import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

beforeEach(() => {
  h.tracked = []
  h.user = { id: 5, agencyId: 42 }
  h.inApp = null
})

describe('whatsapp_connect_failed (client)', () => {
  it.each(['cancelled', 'sdk', 'timeout', 'config', 'network', 'session'])('records reason %s', async (reason) => {
    await recordLeadActionEvent('whatsapp_connect_failed', { reason })
    expect(h.tracked).toEqual([
      { agencyId: 42, userId: 5, event: 'whatsapp_connect_failed', props: { reason, stage: 'client', inApp: null } },
    ])
  })

  it('carries the server-detected in-app browser', async () => {
    h.inApp = 'instagram'
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'cancelled' })
    expect(h.tracked[0].props).toEqual({ reason: 'cancelled', stage: 'client', inApp: 'instagram' })
  })

  it('rejects a missing, unknown, or contact-vocabulary reason', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed')
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'token' })
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'no_phone' })
    expect(h.tracked).toHaveLength(0)
  })

  it('never lets the client set stage, inApp, or extra props', async () => {
    h.inApp = null
    await recordLeadActionEvent('whatsapp_connect_failed', {
      reason: 'sdk',
      stage: 'subscribe',
      inApp: 'instagram',
      phone: '+972500000000',
    })
    expect(h.tracked[0].props).toEqual({ reason: 'sdk', stage: 'client', inApp: null })
  })

  it('never throws when the user cannot be resolved', async () => {
    h.user = null
    await expect(recordLeadActionEvent('whatsapp_connect_failed', { reason: 'sdk' })).resolves.toBeUndefined()
    expect(h.tracked).toHaveLength(0)
  })
})

describe('neighbouring events are unchanged', () => {
  it('whatsapp_connect_started carries only the server-detected in-app browser', async () => {
    h.inApp = 'facebook'
    await recordLeadActionEvent('whatsapp_connect_started', { surface: 'mobile', phone: '+972500000000' })
    expect(h.tracked[0].props).toEqual({ inApp: 'facebook' })
  })

  it('the contact triad keeps its own reason vocabulary', async () => {
    await recordLeadActionEvent('lead_contact_blocked', { reason: 'no_phone' })
    await recordLeadActionEvent('lead_contact_blocked', { reason: 'cancelled' })
    expect(h.tracked.map((t) => t.props?.reason)).toEqual(['no_phone'])
  })
})
