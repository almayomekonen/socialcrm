import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const ingestStatuses = vi.fn(async (_phoneNumberId?: string, _statuses?: unknown[]) => ({ applied: 1, errored: 0, noConnection: false }))
const recordEvents = vi.fn(async (events: unknown[]) => ({ insertedIds: events.map((_, i) => i + 1), duplicates: 0 }))
const CONNECTION = { agency_id: 7, user_id: 1, phone_number_id: '1216762448189306' }
const runWorker = vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 }))

vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: ingestStatuses }))
vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/config/db', () => ({
  db: () => ({ where: () => ({ first: async () => CONNECTION }), whereIn: () => ({ select: async () => [CONNECTION] }) }),
}))
vi.mock('@/db/whatsappWebhookEvents', () => ({ recordWhatsappEvents: recordEvents }))
vi.mock('@/lib/whatsapp/webhook/worker', () => ({ runWhatsappWebhookWorker: vi.fn(async () => ({})) }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => void fn() }
})
vi.mock('@/lib/inbox/ingestWhatsappInbound', () => ({ ingestWhatsappInbound: vi.fn() }))
vi.mock('@/lib/system/createLeadFromWhatsappWebhook', () => ({ createLeadFromWhatsappWebhook: vi.fn() }))

const SECRET = 'test-app-secret'
process.env.META_APP_SECRET = SECRET

const { POST } = await import('@/app/api/webhooks/whatsapp/route')

function signedRequest(body: unknown): Request {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body: raw,
  })
}

function statusPayload() {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1216762448189306' },
              statuses: [{ id: 'wamid.A', status: 'failed', timestamp: '1784462400', errors: [{ code: 131047 }] }],
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  ingestStatuses.mockClear()
  runWorker.mockClear()
  ingestStatuses.mockImplementation(async () => ({ applied: 1, errored: 0, noConnection: false }))
  recordEvents.mockClear()
  delete process.env.WA_WEBHOOK_DIRECT_PROCESSING
})

describe('whatsapp webhook — statuses branch', () => {
  it('durable (default): records a status receipt and acknowledges; nothing is applied inside the request', async () => {
    const res = await POST(signedRequest(statusPayload()) as never)
    expect(res.status).toBe(200)
    expect(recordEvents).toHaveBeenCalledTimes(1)
    const [events] = recordEvents.mock.calls[0] as unknown as [{ kind: string; eventKey: string; phoneNumberId: string; agencyId: number }[]]
    expect(events).toEqual([expect.objectContaining({ kind: 'status', eventKey: 'st:wamid.A:failed:1784462400', phoneNumberId: '1216762448189306', agencyId: 7 })])
    expect(ingestStatuses).not.toHaveBeenCalled()
  })

  it('durable: a receipt that cannot be written is not acknowledged (503), and nothing falls back to direct processing', async () => {
    recordEvents.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(signedRequest(statusPayload()) as never)
    expect(res.status).toBe(503)
    expect(ingestStatuses).not.toHaveBeenCalled()
  })

  it('direct (kill switch): routes the status to the ingester inside the request', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    const res = await POST(signedRequest(statusPayload()) as never)
    expect(res.status).toBe(200)
    expect(ingestStatuses).toHaveBeenCalledTimes(1)
    expect(ingestStatuses.mock.calls[0][0]).toBe('1216762448189306')
    expect(recordEvents).not.toHaveBeenCalled()
  })

  it('direct: a status that was not applied is not acknowledged (503), so Meta redelivers it', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    ingestStatuses.mockRejectedValueOnce(new Error('boom'))
    expect((await POST(signedRequest(statusPayload()) as never)).status).toBe(503)
    ingestStatuses.mockResolvedValueOnce({ applied: 0, errored: 1, noConnection: false })
    expect((await POST(signedRequest(statusPayload()) as never)).status).toBe(503)
  })

  it('NEVER triggers the auto-response worker, in either mode (would duplicate customer sends)', async () => {
    await POST(signedRequest(statusPayload()) as never)
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    await POST(signedRequest(statusPayload()) as never)
    expect(runWorker).not.toHaveBeenCalled()
  })

  it('rejects an unsigned payload before any ingestion', async () => {
    const res = await POST(
      new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
        method: 'POST',
        body: JSON.stringify(statusPayload()),
      }) as never,
    )
    expect(res.status).toBe(403)
    expect(ingestStatuses).not.toHaveBeenCalled()
  })
})
