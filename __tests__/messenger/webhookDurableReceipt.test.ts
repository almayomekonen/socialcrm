/**
 * The Facebook webhook's Messenger contract on the SHARED endpoint.
 *
 *  · Messenger events are durably recorded BEFORE the response.
 *  · If that write fails the delivery is NOT acknowledged (503) — never a 200
 *    that claims receipt — while Lead Ads and comments in the same delivery are
 *    still processed (both idempotent on the redelivery the 503 causes).
 *  · Deliveries without Messenger events keep answering 200 exactly as before.
 *  · Processing is kicked after the response for the newly recorded receipts only.
 */
import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  process.env.META_APP_SECRET = 'secret'
  return {
    receive: vi.fn(),
    worker: vi.fn(async () => ({})),
    comment: vi.fn(async () => 'ingested'),
    leadLookups: [] as unknown[],
    afterCallbacks: [] as (() => unknown)[],
  }
})

vi.mock('@/lib/facebook/messenger/receiveMessagingEvents', () => ({ receiveMessagingEvents: h.receive }))
vi.mock('@/lib/facebook/messenger/eventWorker', () => ({ runMessengerEventWorker: h.worker }))
vi.mock('@/lib/system/ingestFacebookComment', () => ({ ingestFacebookComment: h.comment }))
vi.mock('@/lib/facebook/commentsCanary', () => ({ logCanaryFeedEvent: vi.fn() }))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => void h.afterCallbacks.push(cb) }
})
vi.mock('@/config/db', () => {
  const qb: Record<string, unknown> = {}
  qb.whereIn = (...args: unknown[]) => {
    h.leadLookups.push(args)
    return qb
  }
  qb.where = () => qb
  qb.first = async () => ({ id: 1 }) // lead already exists → the leadgen path's own dedup short-circuits
  return { db: Object.assign(() => qb, { raw: () => ({}) }) }
})

import { POST } from '@/app/api/webhooks/facebook/route'

function signed(body: unknown) {
  const raw = JSON.stringify(body)
  return new Request('https://x/api/webhooks/facebook', {
    method: 'POST',
    body: raw,
    headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex') },
  }) as never
}

const mixed = {
  object: 'page',
  entry: [
    {
      id: 'PAGE',
      messaging: [{ sender: { id: 'U' }, recipient: { id: 'PAGE' }, message: { mid: 'a', text: 'hi' } }],
      changes: [
        { field: 'feed', value: { item: 'comment' } },
        { field: 'leadgen', value: { leadgen_id: 'L1' } },
      ],
    },
  ],
}

beforeEach(() => {
  h.receive.mockReset()
  h.worker.mockClear()
  h.comment.mockClear()
  h.leadLookups = []
  h.afterCallbacks = []
})

describe('Messenger durable receipt on the shared webhook', () => {
  it('recorded → 200, and the worker is kicked after the response for exactly those receipts', async () => {
    h.receive.mockResolvedValue({ outcome: 'recorded', recordedIds: [41, 42], duplicates: 0, ignored: 0 })
    const res = await POST(signed(mixed))
    expect(res.status).toBe(200)
    expect(h.receive).toHaveBeenCalledWith(mixed.entry)
    expect(h.worker).not.toHaveBeenCalled() // not inside the request
    await Promise.all(h.afterCallbacks.map((cb) => cb()))
    expect(h.worker).toHaveBeenCalledWith(expect.objectContaining({ ids: [41, 42] }))
  })

  it('durable write FAILED → 503 (receipt never claimed), while the lead and the comment in the same delivery still ran', async () => {
    h.receive.mockResolvedValue({ outcome: 'failed' })
    const res = await POST(signed(mixed))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'messenger_receipt_failed' })
    expect(h.comment).toHaveBeenCalledTimes(1)
    expect(h.leadLookups.length).toBeGreaterThan(0)
    expect(h.afterCallbacks).toHaveLength(0)
  })

  it('a redelivery whose events are all duplicates → 200 and no worker kick', async () => {
    h.receive.mockResolvedValue({ outcome: 'recorded', recordedIds: [], duplicates: 1, ignored: 0 })
    const res = await POST(signed(mixed))
    expect(res.status).toBe(200)
    expect(h.afterCallbacks).toHaveLength(0)
  })

  it('a Lead Ads-only delivery is unchanged: 200, no receipt written', async () => {
    h.receive.mockResolvedValue({ outcome: 'none' })
    const leadsOnly = { object: 'page', entry: [{ id: 'PAGE', changes: [{ field: 'leadgen', value: { leadgen_id: 'L2' } }] }] }
    const res = await POST(signed(leadsOnly))
    expect(res.status).toBe(200)
    expect(h.leadLookups.length).toBeGreaterThan(0)
  })

  it('a bad signature is rejected before any receipt is attempted', async () => {
    const raw = JSON.stringify(mixed)
    const res = await POST(
      new Request('https://x/api/webhooks/facebook', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }) as never,
    )
    expect(res.status).toBe(403)
    expect(h.receive).not.toHaveBeenCalled()
  })
})
