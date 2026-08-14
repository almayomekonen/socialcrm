import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const processCoexistence = vi.hoisted(() =>
  vi.fn((field: string, _value: unknown) => ({ ok: true as const, field })),
)
const createLead = vi.hoisted(() => vi.fn())
const ingestInbound = vi.hoisted(() => vi.fn())
const runWorker = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 })))

vi.mock('@/lib/whatsapp/coexistence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/coexistence')>('@/lib/whatsapp/coexistence')
  return { ...actual, processCoexistenceWebhook: processCoexistence }
})
vi.mock('@/lib/system/createLeadFromWhatsappWebhook', () => ({ createLeadFromWhatsappWebhook: createLead }))
vi.mock('@/lib/inbox/ingestWhatsappInbound', () => ({ ingestWhatsappInbound: ingestInbound }))
vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: vi.fn() }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))

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

function coexistencePayload(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_1',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
              ...value,
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  processCoexistence.mockClear()
  createLead.mockClear()
  ingestInbound.mockClear()
  runWorker.mockClear()
})

describe('whatsapp webhook — coexistence fields reach the processing pipeline', () => {
  it.each([
    ['history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [] }] }],
    ['smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { full_name: 'Ada', phone_number: '16505551234' } }] }],
    [
      'smb_message_echoes',
      {
        message_echoes: [
          { from: '15550783881', to: '16505551234', id: 'wamid.ECHO', timestamp: '1738796547', type: 'text', text: { body: 'hi' } },
        ],
      },
    ],
  ] as const)('%s payload is processed and never treated as inbound', async (field, value) => {
    const res = await POST(signed(coexistencePayload(field, value)) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(processCoexistence).toHaveBeenCalledTimes(1)
    expect(processCoexistence.mock.calls[0][0]).toBe(field)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).not.toHaveBeenCalled()
    expect(runWorker).not.toHaveBeenCalled()
  })
})
