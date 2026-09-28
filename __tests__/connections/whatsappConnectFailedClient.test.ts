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
  serverOutcome: false,
  outcomeSince: [] as Date[],
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
vi.mock('@/lib/analytics/connectOutcome', () => ({
  hasServerConnectOutcomeSince: vi.fn(async (_agencyId: number, since: Date) => {
    h.outcomeSince.push(since)
    return h.serverOutcome
  }),
}))

import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'

beforeEach(() => {
  h.tracked = []
  h.user = { id: 5, agencyId: 42 }
  h.inApp = null
  h.serverOutcome = false
  h.outcomeSince = []
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

describe('whatsapp_connect_failed carries Meta’s explanation, validated', () => {
  it('accepts meta_error and abandoned as reasons', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'meta_error' })
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: 5000 })
    expect(h.tracked.map((t) => t.props?.reason)).toEqual(['meta_error', 'abandoned'])
  })

  it('keeps a known step, a numeric Meta error id and a bounded duration', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', {
      reason: 'cancelled',
      step: 'PHONE_NUMBER_VERIFICATION',
      metaErrorId: '524126',
      elapsedMs: 1234.6,
    })
    expect(h.tracked[0].props).toEqual({
      reason: 'cancelled',
      stage: 'client',
      inApp: null,
      step: 'PHONE_NUMBER_VERIFICATION',
      metaErrorId: '524126',
      elapsedMs: 1235,
    })
  })

  it('drops invalid detail fields but still records the failure', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', {
      reason: 'cancelled',
      step: '<script>',
      metaErrorId: 'abc',
      elapsedMs: -5,
      errorMessage: 'free text never stored',
    })
    expect(h.tracked[0].props).toEqual({ reason: 'cancelled', stage: 'client', inApp: null })
  })

  it('caps a duration at 24 hours', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: 10 * 86_400_000 })
    expect(h.tracked[0].props?.elapsedMs).toBe(86_400_000)
  })
})

describe('abandoned never contradicts an outcome the server recorded', () => {
  it('is dropped when the server recorded a success or failure since the attempt began', async () => {
    h.serverOutcome = true
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: 60_000 })
    expect(h.tracked).toHaveLength(0)
  })

  it('looks back to the attempt start, with a few seconds of slack', async () => {
    const before = Date.now()
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: 60_000 })
    const since = h.outcomeSince[0].getTime()
    expect(since).toBeLessThanOrEqual(before - 60_000)
    expect(since).toBeGreaterThanOrEqual(before - 60_000 - 10_000)
    expect(h.tracked).toHaveLength(1)
  })

  it('is rejected without a duration, since the attempt cannot be bounded', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned' })
    expect(h.tracked).toHaveLength(0)
    expect(h.outcomeSince).toHaveLength(0)
  })

  it('other failures never pay for the lookup', async () => {
    await recordLeadActionEvent('whatsapp_connect_failed', { reason: 'cancelled', elapsedMs: 400 })
    expect(h.outcomeSince).toHaveLength(0)
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
