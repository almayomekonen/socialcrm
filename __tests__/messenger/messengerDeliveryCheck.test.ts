/**
 * Messenger delivery check — "no messages yet" must mean Meta is delivering.
 *
 * Incident 2026-09-14: the grant was recorded and the tab promised messages,
 * while the Page was subscribed to leadgen,feed only. The check asks Meta
 * through the sweep's own check-and-repair. It is cached, single-flight and
 * deadline-bound because every Graph call spends the Page rate limit Lead Ads
 * intake shares, and a render must not stall on a slow Meta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  result: null as unknown,
  throws: false,
  delayMs: 0,
}))

vi.mock('@/lib/facebook/health', () => ({
  repairFacebookConnection: async (pageId: string) => {
    h.calls.push(pageId)
    if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs))
    if (h.throws) throw new Error('Page token could not be opened')
    return h.result
  },
}))

import {
  checkMessengerDelivery,
  pendingMessengerDeliveryChecks,
  resetMessengerDeliveryChecks,
} from '@/lib/facebook/messenger/deliveryCheck'

function repair(status: Record<string, unknown>, extra: { repaired?: boolean; needsReconnect?: boolean } = {}) {
  return {
    repaired: extra.repaired ?? false,
    needsReconnect: extra.needsReconnect ?? false,
    status: { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [], ...status },
  }
}

const T0 = 1_800_000_000_000
const at = (now: number, extra: { rowCheckedAt?: Date | null; waitMs?: number } = {}) => ({ now, ...extra })

beforeEach(() => {
  resetMessengerDeliveryChecks()
  h.calls = []
  h.throws = false
  h.delayMs = 0
  h.result = repair({ missingFields: [] })
})

describe('checkMessengerDelivery — verdicts', () => {
  it('ready when the Page is subscribed to everything it needs (after repair or already)', async () => {
    h.result = repair({ missingFields: [] }, { repaired: true })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('ready')
    expect(h.calls).toEqual(['PG1'])
  })

  it('not_subscribed when Messenger fields are still missing after the repair attempt', async () => {
    h.result = repair({ missingFields: ['messages', 'message_echoes'] })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('not_subscribed')
  })

  it('not_subscribed when even Lead Ads fields are missing and could not be restored', async () => {
    h.result = repair({ subscribed: false, missingFields: ['feed'] })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('not_subscribed')
  })

  it('reconnect only when Meta refused the token', async () => {
    h.result = repair({ tokenValid: false, errors: ['token_invalid'] }, { needsReconnect: true })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('reconnect')
  })

  it.each(['token_check_timeout', 'token_check_failed'])('unknown — never a false alarm — for %s', async (code) => {
    h.result = repair({ tokenValid: false, errors: [code] }, { needsReconnect: true })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('unknown')
  })

  it('not_subscribed — a reconnect, not an expired connection — when a permission is missing', async () => {
    h.result = repair({ tokenValid: false, errors: ['permission_missing'] }, { needsReconnect: true })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('not_subscribed')
  })

  it('unknown when the subscription could not be read', async () => {
    h.result = repair({ missingFields: undefined })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('unknown')
  })

  it('unknown when the check throws (e.g. a seal this deployment cannot open)', async () => {
    h.throws = true
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('unknown')
  })
})

describe('checkMessengerDelivery — cost and freshness', () => {
  it('asks Meta once per Page per five minutes while the tab refreshes every 10 seconds', async () => {
    for (let i = 0; i < 30; i++) await checkMessengerDelivery('PG1', at(T0 + i * 10_000))
    expect(h.calls).toEqual(['PG1'])
    await checkMessengerDelivery('PG1', at(T0 + 5 * 60_000))
    expect(h.calls).toEqual(['PG1', 'PG1'])
  })

  it('caches per Page, never across Pages', async () => {
    await checkMessengerDelivery('PG1', at(T0))
    await checkMessengerDelivery('PG2', at(T0))
    expect(h.calls).toEqual(['PG1', 'PG2'])
  })

  it('re-asks after one minute when the previous answer was unknown', async () => {
    h.throws = true
    await checkMessengerDelivery('PG1', at(T0))
    await checkMessengerDelivery('PG1', at(T0 + 30_000))
    expect(h.calls).toHaveLength(1)
    h.throws = false
    expect(await checkMessengerDelivery('PG1', at(T0 + 60_000))).toBe('ready')
    expect(h.calls).toHaveLength(2)
  })

  it('a reconnect written to the Page row after the cached answer makes it stale on every instance', async () => {
    h.result = repair({ missingFields: ['messages', 'message_echoes'] })
    expect(await checkMessengerDelivery('PG1', at(T0))).toBe('not_subscribed')

    // The admin reconnects 20 s later; refreshConnectedPages writes health_checked_at.
    h.result = repair({ missingFields: [] })
    const reconnectedAt = new Date(T0 + 20_000)
    expect(await checkMessengerDelivery('PG1', at(T0 + 30_000, { rowCheckedAt: reconnectedAt }))).toBe('ready')
    expect(h.calls).toHaveLength(2)

    // The same row timestamp on later refreshes does not force another check.
    await checkMessengerDelivery('PG1', at(T0 + 40_000, { rowCheckedAt: reconnectedAt }))
    expect(h.calls).toHaveLength(2)
  })

  it('an unparseable row timestamp never disables the cache', async () => {
    await checkMessengerDelivery('PG1', at(T0, { rowCheckedAt: 'not a date' as unknown as Date }))
    await checkMessengerDelivery('PG1', at(T0 + 10_000, { rowCheckedAt: 'not a date' as unknown as Date }))
    expect(h.calls).toHaveLength(1)
  })

  it('does not join a check that started before the reconnect was written', async () => {
    h.delayMs = 40
    const before = checkMessengerDelivery('PG1', at(T0, { waitMs: 100 }))
    await checkMessengerDelivery('PG1', at(T0 + 5_000, { rowCheckedAt: new Date(T0 + 1_000), waitMs: 100 }))
    await before
    expect(h.calls).toEqual(['PG1', 'PG1'])
  })

  it('a check hung for more than 15 s is replaced, not waited on forever', async () => {
    h.delayMs = 50
    expect(await checkMessengerDelivery('PG1', at(T0, { waitMs: 5 }))).toBe('unknown')
    expect(await checkMessengerDelivery('PG1', at(T0 + 10_000, { waitMs: 5 }))).toBe('unknown')
    expect(h.calls).toHaveLength(1)
    await checkMessengerDelivery('PG1', at(T0 + 16_000, { waitMs: 5 }))
    expect(h.calls).toHaveLength(2)
    await pendingMessengerDeliveryChecks()
    // The replaced check is no longer tracked; let it finish so it cannot write into the next test.
    await new Promise((r) => setTimeout(r, 60))
  })

  it('concurrent renders share one check', async () => {
    h.delayMs = 20
    const verdicts = await Promise.all([1, 2, 3].map(() => checkMessengerDelivery('PG1', at(T0))))
    expect(verdicts).toEqual(['ready', 'ready', 'ready'])
    expect(h.calls).toEqual(['PG1'])
  })

  it('a slow Meta answers unknown within the deadline, then the finished check fills the cache', async () => {
    h.delayMs = 60
    expect(await checkMessengerDelivery('PG1', at(T0, { waitMs: 10 }))).toBe('unknown')
    await pendingMessengerDeliveryChecks()
    expect(await checkMessengerDelivery('PG1', at(T0 + 10_000, { waitMs: 10 }))).toBe('ready')
    expect(h.calls).toEqual(['PG1'])
  })
})
