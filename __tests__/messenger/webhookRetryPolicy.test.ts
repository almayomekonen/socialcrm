/**
 * Messenger failures on the SHARED Facebook webhook.
 *
 * This callback URL also carries Lead Ads and comments, so it always answers
 * 200: a sustained non-2xx gets the app's webhooks disabled by Meta. A transient
 * database error gets exactly one immediate in-request retry; a permanent one
 * none. Sibling events — other messages, comments, leads — always run.
 */
import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  process.env.META_APP_SECRET = 'secret'
  return { ingest: vi.fn(), comment: vi.fn(async () => 'ingested'), leadLookups: [] as unknown[], profile: vi.fn() }
})

vi.mock('@/lib/facebook/messenger/ingestMessengerEvent', () => ({ ingestMessengerEvent: h.ingest }))
vi.mock('@/lib/facebook/messenger/profile', () => ({ fillMessengerCustomerName: h.profile }))
vi.mock('@/lib/system/ingestFacebookComment', () => ({ ingestFacebookComment: h.comment }))
vi.mock('@/lib/facebook/commentsCanary', () => ({ logCanaryFeedEvent: vi.fn() }))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => void cb() }
})
vi.mock('@/config/db', () => {
  const qb: Record<string, unknown> = {}
  qb.whereIn = (...args: unknown[]) => {
    h.leadLookups.push(args)
    return qb
  }
  qb.where = () => qb
  qb.first = async () => ({ id: 1 }) // lead already exists → leadgen path short-circuits (idempotent)
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

const batch = {
  object: 'page',
  entry: [
    {
      id: 'PAGE',
      messaging: [{ message: { mid: 'a' } }, { message: { mid: 'b' } }],
      changes: [
        { field: 'feed', value: { item: 'comment' } },
        { field: 'leadgen', value: { leadgen_id: 'L1' } },
      ],
    },
  ],
}

const stored = (newConversation: boolean) => ({ status: 'stored', conversationId: 1, agencyId: 1, direction: 'inbound', newConversation })

beforeEach(() => {
  h.ingest.mockReset()
  h.comment.mockClear()
  h.profile.mockClear()
  h.leadLookups = []
})

describe('Messenger failures inside a mixed batch', () => {
  it('a transient DB error is retried once in the request; the event is stored; 200', async () => {
    h.ingest
      .mockRejectedValueOnce(Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' }))
      .mockResolvedValueOnce(stored(false))
      .mockResolvedValueOnce({ status: 'duplicate' })
    const res = await POST(signed(batch))
    expect(res.status).toBe(200)
    expect(h.ingest).toHaveBeenCalledTimes(3) // event a twice (retry), event b once
    expect(h.comment).toHaveBeenCalledTimes(1)
    expect(h.leadLookups.length).toBeGreaterThan(0)
  })

  it('a transient error that persists: still 200, logged without content, siblings still run', async () => {
    h.ingest.mockRejectedValue(Object.assign(new Error('Timeout acquiring a connection'), { code: undefined }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(signed(batch))
    expect(res.status).toBe(200)
    expect(h.ingest).toHaveBeenCalledTimes(4) // two events × (try + one retry)
    expect(h.comment).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it('a permanent DB error is not retried; 200; the log carries SQLSTATE only', async () => {
    h.ingest.mockRejectedValue(Object.assign(new Error('violates check constraint "x" for text שלום'), { code: '23514' }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(signed(batch))
    expect(res.status).toBe(200)
    expect(h.ingest).toHaveBeenCalledTimes(2)
    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).toContain('sqlstate=23514')
    expect(logged).not.toContain('שלום')
    errors.mockRestore()
  })

  it('the contact name is looked up only for a NEW conversation', async () => {
    h.ingest.mockResolvedValueOnce(stored(true)).mockResolvedValueOnce(stored(false))
    expect((await POST(signed(batch))).status).toBe(200)
    expect(h.profile).toHaveBeenCalledTimes(1)
  })
})
