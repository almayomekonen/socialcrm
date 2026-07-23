import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const ingestStatuses = vi.fn(async () => {})
const runWorker = vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 }))

vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: ingestStatuses }))
vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))
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
  ingestStatuses.mockImplementation(async () => {})
})

describe('whatsapp webhook — statuses branch', () => {
  it('routes a statuses payload to the ingester', async () => {
    const res = await POST(signedRequest(statusPayload()) as never)
    expect(res.status).toBe(200)
    expect(ingestStatuses).toHaveBeenCalledTimes(1)
    expect(ingestStatuses.mock.calls[0][0]).toBe('1216762448189306')
  })

  it('NEVER triggers the auto-response worker (would duplicate customer sends)', async () => {
    await POST(signedRequest(statusPayload()) as never)
    expect(runWorker).not.toHaveBeenCalled()
  })

  it('answers 200 even when the ingester throws, so Meta does not retry', async () => {
    ingestStatuses.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(signedRequest(statusPayload()) as never)
    expect(res.status).toBe(200)
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
