import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const ingestTemplate = vi.fn(async (_wabaId?: string, _field?: string, _value?: unknown) => {})
const runWorker = vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 }))

vi.mock('@/lib/whatsapp/templates/ingestStatus', () => ({ ingestTemplateStatusUpdate: ingestTemplate }))
vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: vi.fn() }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))
vi.mock('@/lib/inbox/ingestWhatsappInbound', () => ({ ingestWhatsappInbound: vi.fn() }))
vi.mock('@/lib/system/createLeadFromWhatsappWebhook', () => ({ createLeadFromWhatsappWebhook: vi.fn() }))

const SECRET = 'test-app-secret'
process.env.META_APP_SECRET = SECRET

const { POST } = await import('@/app/api/webhooks/whatsapp/route')

function signed(body: unknown): Request {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
    body: raw,
  })
}

function templatePayload(field = 'message_template_status_update') {
  return {
    entry: [
      {
        id: 'WABA_1',
        changes: [{ field, value: { event: 'APPROVED', message_template_name: 'follow_up', message_template_language: 'he' } }],
      },
    ],
  }
}

beforeEach(() => {
  ingestTemplate.mockClear()
  runWorker.mockClear()
  ingestTemplate.mockImplementation(async () => {})
})

describe('whatsapp webhook — template branch', () => {
  it('routes a template status event to the ingester with the WABA id and value', async () => {
    const res = await POST(signed(templatePayload()) as never)
    expect(res.status).toBe(200)
    expect(ingestTemplate).toHaveBeenCalledTimes(1)
    expect(ingestTemplate.mock.calls[0][0]).toBe('WABA_1')
    expect(ingestTemplate.mock.calls[0][1]).toBe('message_template_status_update')
  })

  it('also routes quality updates', async () => {
    await POST(signed(templatePayload('message_template_quality_update')) as never)
    expect(ingestTemplate.mock.calls[0][1]).toBe('message_template_quality_update')
  })

  it('NEVER triggers the auto-response worker', async () => {
    await POST(signed(templatePayload()) as never)
    expect(runWorker).not.toHaveBeenCalled()
  })

  it('always answers 200 even when the ingester throws (Meta must not retry)', async () => {
    ingestTemplate.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(signed(templatePayload()) as never)
    expect(res.status).toBe(200)
  })

  it('rejects an unsigned payload before any ingestion', async () => {
    const res = await POST(
      new Request('https://getsocialcrm.com/api/webhooks/whatsapp', { method: 'POST', body: JSON.stringify(templatePayload()) }) as never,
    )
    expect(res.status).toBe(403)
    expect(ingestTemplate).not.toHaveBeenCalled()
  })
})
