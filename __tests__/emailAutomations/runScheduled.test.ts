import { describe, it, expect, vi } from 'vitest'
import { runScheduledAutomations } from '@/lib/emailAutomations/runScheduled'
import type { Automation, Recipient } from '@/lib/emailAutomations/types'

const rec = (id: number): Recipient => ({ userId: id, agencyId: id, email: `u${id}@x.com`, firstName: null })

const auto = (over: Partial<Automation> = {}): Automation => ({
  key: 'a',
  enabled: true,
  priority: 'normal',
  category: 'lifecycle',
  trigger: 'scheduled',
  subject: () => 's',
  template: () => ({}) as never,
  audience: async () => [rec(1)],
  ...over,
})

describe('runScheduledAutomations (generic orchestration)', () => {
  it('processes only enabled scheduled automations', async () => {
    const dispatch = vi.fn(async (_a: Automation, _r: Recipient) => 'sent' as const)
    const summary = await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [
        auto({ key: 'sched' }),
        auto({ key: 'disabled', enabled: false }),
        auto({ key: 'evt', trigger: 'event', event: 'user.registered', audience: undefined }),
      ],
    })
    expect(summary.automations).toBe(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0].key).toBe('sched')
  })

  it('runs high priority before normal', async () => {
    const order: string[] = []
    const dispatch = vi.fn(async (a: Automation) => {
      order.push(a.key)
      return 'sent' as const
    })
    await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [auto({ key: 'n', priority: 'normal' }), auto({ key: 'h', priority: 'high' })],
    })
    expect(order).toEqual(['h', 'n'])
  })

  it('applies the automation condition filter', async () => {
    const dispatch = vi.fn(async () => 'sent' as const)
    const summary = await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [auto({ audience: async () => [rec(1), rec(2)], condition: async (r) => r.userId === 2 })],
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(summary.considered).toBe(2)
    expect(summary.sent).toBe(1)
  })

  it('tallies each dispatch result', async () => {
    const results = ['sent', 'skipped', 'suppressed'] as const
    let i = 0
    const dispatch = vi.fn(async () => results[i++])
    const summary = await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [auto({ audience: async () => [rec(1), rec(2), rec(3)] })],
    })
    expect(summary).toMatchObject({ sent: 1, skipped: 1, suppressed: 1, considered: 3 })
  })

  it('isolates a throwing dispatch (counts failed, continues)', async () => {
    const dispatch = vi.fn(async (_a: Automation, r: Recipient) => {
      if (r.userId === 1) throw new Error('boom')
      return 'sent' as const
    })
    const summary = await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [auto({ audience: async () => [rec(1), rec(2)] })],
    })
    expect(summary.failed).toBe(1)
    expect(summary.sent).toBe(1)
  })

  it('isolates a throwing audience (skips that automation, continues)', async () => {
    const dispatch = vi.fn(async () => 'sent' as const)
    const summary = await runScheduledAutomations({
      now: new Date(),
      dispatch,
      automations: [
        auto({
          key: 'bad',
          audience: async () => {
            throw new Error('db down')
          },
        }),
        auto({ key: 'good' }),
      ],
    })
    expect(summary.automations).toBe(2)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
