import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const processCoexistence = vi.hoisted(() =>
  vi.fn((field: string, _value: unknown) => ({ ok: true as const, field })),
)
const createLead = vi.hoisted(() => vi.fn())
const ingestInbound = vi.hoisted(() => vi.fn())
const runWorker = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 })))
const ingestEchoes = vi.hoisted(() => vi.fn(async () => ({ parsed: 1, persisted: 1, duplicates: 0, skipped: 0, errored: 0 })))
const recordEvents = vi.hoisted(() => vi.fn(async (events: unknown[]) => ({ insertedIds: events.map((_, i) => i + 1), duplicates: 0 })))
const CONNECTION = { agency_id: 5, user_id: 1, phone_number_id: '106540352242922' }

vi.mock('@/lib/whatsapp/coexistence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/coexistence')>('@/lib/whatsapp/coexistence')
  return { ...actual, processCoexistenceWebhook: processCoexistence }
})
vi.mock('@/lib/system/createLeadFromWhatsappWebhook', () => ({ createLeadFromWhatsappWebhook: createLead }))
vi.mock('@/lib/inbox/ingestWhatsappInbound', () => ({ ingestWhatsappInbound: ingestInbound }))
vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: vi.fn() }))
vi.mock('@/lib/inbox/ingestWhatsappEcho', () => ({ ingestWhatsappEchoes: ingestEchoes }))
vi.mock('@/db/whatsappWebhookEvents', () => ({ recordWhatsappEvents: recordEvents }))
vi.mock('@/lib/whatsapp/webhook/worker', () => ({ runWhatsappWebhookWorker: vi.fn(async () => ({})) }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => void fn() }
})
vi.mock('@/config/db', () => ({
  db: () => ({ where: () => ({ first: async () => CONNECTION }), whereIn: () => ({ select: async () => [CONNECTION] }) }),
}))

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
  ingestEchoes.mockClear()
  recordEvents.mockClear()
  delete process.env.WA_WEBHOOK_DIRECT_PROCESSING
})

const recordedKinds = () => (recordEvents.mock.calls.flatMap((c) => c[0] as { kind: string }[]) ?? []).map((e) => e.kind)

describe('whatsapp webhook — coexistence fields reach the processing pipeline', () => {
  it.each([
    ['history', { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [] }] }],
    ['smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { full_name: 'Ada', phone_number: '16505551234' } }] }],
  ] as const)('%s keeps its inline Coexistence handling and is never treated as inbound', async (field, value) => {
    const res = await POST(signed(coexistencePayload(field, value)) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(processCoexistence).toHaveBeenCalledTimes(1)
    expect(processCoexistence.mock.calls[0][0]).toBe(field)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).not.toHaveBeenCalled()
    expect(runWorker).not.toHaveBeenCalled()
    expect(recordEvents).not.toHaveBeenCalled()
  })

  const ECHO = { message_echoes: [{ from: '15550783881', to: '16505551234', id: 'wamid.ECHO', timestamp: '1738796547', type: 'text', text: { body: 'hi' } }] }

  it('smb_message_echoes is recorded as a durable ECHO event, never as inbound', async () => {
    const res = await POST(signed(coexistencePayload('smb_message_echoes', ECHO)) as never)
    expect(res.status).toBe(200)
    expect(recordedKinds()).toEqual(['echo'])
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).not.toHaveBeenCalled()
    expect(runWorker).not.toHaveBeenCalled()
  })

  it('direct mode: smb_message_echoes reaches the echo ingester, never inbound', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    const res = await POST(signed(coexistencePayload('smb_message_echoes', ECHO)) as never)
    expect(res.status).toBe(200)
    expect(ingestEchoes).toHaveBeenCalledTimes(1)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).not.toHaveBeenCalled()
  })
})

describe('whatsapp webhook — inbound messages and echoes stay apart', () => {
  it('an inbound message never reaches the coexistence pipeline', async () => {
    const res = await POST(signed(coexistencePayload('messages', { messages: [{ id: 'wamid.IN', from: '16505551234', type: 'text', text: { body: 'hi' } }] })) as never)
    expect(res.status).toBe(200)
    expect(processCoexistence).not.toHaveBeenCalled()
  })

  it('an echo with an inbound-shaped `messages` array is still an echo', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    const res = await POST(signed(coexistencePayload('smb_message_echoes', { messages: [{ id: 'wamid.X', from: '16505551234', type: 'text', text: { body: 'hi' } }] })) as never)
    expect(res.status).toBe(200)
    // An echo field's `messages` array is never read as inbound: only `message_echoes` is.
    expect(recordEvents).not.toHaveBeenCalled()
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).not.toHaveBeenCalled()
  })

  it('every change is read: an inbound message and an echo in one delivery each keep their own kind', async () => {
    const payload = coexistencePayload('messages', { messages: [{ id: 'wamid.IN', from: '16505551234', type: 'text', text: { body: 'hi' } }] })
    payload.entry[0].changes.push(coexistencePayload('smb_message_echoes', { message_echoes: [{ from: '15550783881', to: '16505551234', id: 'wamid.E2', type: 'text', text: { body: 'x' } }] }).entry[0].changes[0])
    const res = await POST(signed(payload) as never)
    expect(res.status).toBe(200)
    expect(recordedKinds().sort()).toEqual(['echo', 'message'])
    expect(processCoexistence).not.toHaveBeenCalled()
  })

})
