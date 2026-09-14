/**
 * `whatsapp_connect_started` — the connect funnel's denominator.
 *
 * Production had 0 of these against 53 `facebook_connect_started`, because the
 * only emitter was `/api/auth/whatsapp`, a classic-OAuth redirect route no part
 * of the product calls. The real entry point is the Embedded Signup dialog
 * launched in the browser, so the event has to be client-emittable — which means
 * the allowlist that stops a client posting arbitrary event names has to keep
 * holding while letting exactly this one through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tracked: [] as { event: string; props?: Record<string, unknown> }[],
  user: { id: 5, agencyId: 42 } as { id: number; agencyId: number } | null,
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

import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

beforeEach(() => {
  h.tracked = []
  h.user = { id: 5, agencyId: 42 }
})

describe('whatsapp_connect_started', () => {
  it('is emitted exactly once per call, scoped to the caller', async () => {
    await recordLeadActionEvent('whatsapp_connect_started')
    const events = h.tracked.filter((t) => t.event === 'whatsapp_connect_started')
    expect(events).toHaveLength(1)
    expect(h.tracked[0]).toMatchObject({ agencyId: 42, userId: 5 })
  })

  it('carries no client-supplied payload — only the server-detected in-app browser', async () => {
    await recordLeadActionEvent('whatsapp_connect_started', { surface: 'mobile' })
    // Outside a request there is no User-Agent to read, so detection degrades to null.
    expect(h.tracked[0].props).toEqual({ inApp: null })
  })

  it('never throws, so a failed emit cannot block the Meta dialog', async () => {
    h.user = null
    await expect(recordLeadActionEvent('whatsapp_connect_started')).resolves.toBeUndefined()
    expect(h.tracked).toHaveLength(0)
  })
})

describe('client allowlist still holds', () => {
  it('rejects an event name that is not client-emittable', async () => {
    await recordLeadActionEvent('whatsapp_disconnected' as never)
    await recordLeadActionEvent('registration_completed' as never)
    await recordLeadActionEvent('trial_started' as never)
    expect(h.tracked).toHaveLength(0)
  })

  it('still lets the pre-existing allowlisted events through', async () => {
    await recordLeadActionEvent('first_run_viewed', { surface: 'desktop', metaConnected: false, whatsappConnected: false })
    await recordLeadActionEvent('connection_offered', { surface: 'desktop' })
    await recordLeadActionEvent('connection_deferred', { surface: 'mobile' })
    expect(h.tracked.map((t) => t.event)).toEqual(['first_run_viewed', 'connection_offered', 'connection_deferred'])
  })

  it('still rejects an invalid surface rather than coercing it', async () => {
    await recordLeadActionEvent('connection_offered', { surface: 'tablet' })
    expect(h.tracked).toHaveLength(0)
  })
})
