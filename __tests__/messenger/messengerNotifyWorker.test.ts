/**
 * The Messenger worker announces a customer's message once, after the name
 * lookup — and never for an echo, a redelivery or an ignored event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  result: null as unknown,
  order: [] as string[],
  notifyOk: true,
}))

vi.mock('@/lib/facebook/messenger/ingestMessengerEvent', () => ({
  ingestMessengerEvent: async () => {
    h.order.push('ingest')
    return h.result
  },
}))
vi.mock('@/lib/facebook/messenger/profile', () => ({
  fillMessengerCustomerName: async () => void h.order.push('name'),
}))
vi.mock('@/lib/facebook/messenger/notifyMessengerInbound', () => ({
  notifyMessengerInbound: async (input: unknown) => {
    h.order.push(`notify:${JSON.stringify(input)}`)
    return h.notifyOk
  },
}))
vi.mock('@/db/messengerWebhookEvents', () => ({
  settleMessengerEvent: async (_id: number, status: string, outcome: string) => void h.order.push(`settle:${status}/${outcome}`),
  failMessengerEvent: async (_id: number, error: string) => void h.order.push(`fail:${error}`),
  claimMessengerEvents: async () => [],
  reclaimStaleMessengerEvents: async () => 0,
  pruneSettledMessengerEvents: async () => 0,
}))

import { processMessengerEvent } from '@/lib/facebook/messenger/eventWorker'

const ROW = { id: 1, agencyId: 103, pageId: 'PG', payload: {}, attempts: 1 } as never
const AT = new Date('2026-09-15T08:59:32Z')
const stored = (over: Record<string, unknown>) => ({
  status: 'stored',
  conversationId: 9,
  agencyId: 103,
  direction: 'inbound',
  newConversation: false,
  messageId: 77,
  occurredAt: AT,
  ...over,
})
const notifyLine = `notify:${JSON.stringify({ agencyId: 103, conversationId: 9, messageId: 77, occurredAt: AT })}`

beforeEach(() => {
  h.order = []
  h.notifyOk = true
})

describe('processMessengerEvent → notification', () => {
  it("a new contact's first message: stored, named, then announced with that name", async () => {
    h.result = stored({ newConversation: true })
    expect(await processMessengerEvent(ROW)).toBe('stored')
    expect(h.order).toEqual(['ingest', 'name', notifyLine, 'settle:processed/stored'])
  })

  it('a message in an existing conversation is announced without another name lookup', async () => {
    h.result = stored({ newConversation: false })
    await processMessengerEvent(ROW)
    expect(h.order).toEqual(['ingest', notifyLine, 'settle:processed/stored'])
  })

  it('an echo of a message the Page sent never notifies', async () => {
    h.result = stored({ direction: 'outbound' })
    await processMessengerEvent(ROW)
    expect(h.order.some((s) => s.startsWith('notify'))).toBe(false)
  })

  it('a failed enqueue fails the receipt (retried with backoff) instead of settling it silently', async () => {
    h.result = stored({})
    h.notifyOk = false
    expect(await processMessengerEvent(ROW)).toBe('failed')
    expect(h.order).toEqual(['ingest', notifyLine, 'fail:notification_enqueue_failed'])
  })

  it('a retry of a recently stored customer message re-offers its notification (the event key absorbs a repeat)', async () => {
    h.result = {
      status: 'duplicate',
      inbound: { conversationId: 9, agencyId: 103, messageId: 77, occurredAt: AT, storedAt: new Date(Date.now() - 60_000) },
    }
    expect(await processMessengerEvent(ROW)).toBe('duplicate')
    expect(h.order).toEqual(['ingest', notifyLine, 'settle:processed/duplicate'])
  })

  it('a requeued receipt for a message stored hours ago is not re-announced', async () => {
    h.result = {
      status: 'duplicate',
      inbound: { conversationId: 9, agencyId: 103, messageId: 77, occurredAt: AT, storedAt: new Date(Date.now() - 7 * 3600_000) },
    }
    await processMessengerEvent(ROW)
    expect(h.order).toEqual(['ingest', 'settle:processed/duplicate'])
  })

  it('a redelivered echo or an ignored event never notifies', async () => {
    for (const result of [{ status: 'duplicate' }, { status: 'ignored', reason: 'not_enabled' }]) {
      h.order = []
      h.result = result
      await processMessengerEvent(ROW)
      expect(h.order.some((s) => s.startsWith('notify'))).toBe(false)
    }
  })
})
