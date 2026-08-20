import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'

const createLead = vi.hoisted(() => vi.fn())
const ingestInbound = vi.hoisted(() => vi.fn())
const runKick = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 })))
const afterFn = vi.hoisted(() => vi.fn((fn: () => unknown) => fn()))
const canUse = vi.hoisted(() => vi.fn(() => true))
const getMemory = vi.hoisted(() => vi.fn(async () => null))
const findMatches = vi.hoisted(() => vi.fn(async () => []))
const attach = vi.hoisted(() => vi.fn(async () => undefined))
const notifyFailed = vi.hoisted(() => vi.fn(async () => undefined))

const CONNECTION = { agency_id: 69, user_id: 3, phone_number_id: 'PN1' }

vi.mock('@/lib/system/createLeadFromWhatsappWebhook', () => ({ createLeadFromWhatsappWebhook: createLead }))
vi.mock('@/lib/inbox/ingestWhatsappInbound', () => ({ ingestWhatsappInbound: ingestInbound }))
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({ runAutoResponseKick: runKick }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: afterFn }
})
vi.mock('@/lib/inbox/ingestWhatsappStatuses', () => ({ ingestWhatsappStatuses: vi.fn() }))
vi.mock('@/lib/whatsapp/integrationNotifications', () => ({ notifyWhatsappIngestionFailed: notifyFailed }))
vi.mock('@/lib/flags/whatsappContactsFlags', () => ({ canUseWhatsappContacts: canUse }))
vi.mock('@/db/inboxConversations', () => ({
  getConversationMemory: getMemory,
  attachConversationToLead: attach,
}))
vi.mock('@/lib/whatsapp/matchLeadByPhone', () => ({
  findClientsByPhoneCore: findMatches,
}))
vi.mock('@/config/db', () => ({
  db: Object.assign((table: string) => {
    if (table === 'whatsapp_connections') {
      return { where: () => ({ first: async () => CONNECTION }) }
    }
    return { where: () => ({ first: async () => undefined, update: async () => 1 }) }
  }, { fn: { now: () => new Date() } }),
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

function inboundPayload(over: { referral?: Record<string, unknown> } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: 'PN1' },
              contacts: [{ profile: { name: 'Dana' }, wa_id: '972501111111' }],
              messages: [
                {
                  from: '972501111111',
                  id: 'wamid.INBOUND',
                  timestamp: '1738796547',
                  type: 'text',
                  text: { body: 'שלום' },
                  ...(over.referral ? { referral: over.referral } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  createLead.mockReset()
  ingestInbound.mockReset()
  ingestInbound.mockResolvedValue({
    conversationId: 9,
    messageId: 11,
    inserted: true,
    autoResponseDelaySeconds: 0,
    // Task 13: ingest reports whether a durable IRE job was created. The webhook
    // kicks on that, not on the presence of a Lead.
    ireEnqueued: true,
  })
  runKick.mockClear()
  afterFn.mockClear()
  canUse.mockReset()
  canUse.mockReturnValue(true)
  getMemory.mockReset()
  getMemory.mockResolvedValue(null)
  findMatches.mockReset()
  findMatches.mockResolvedValue([])
  attach.mockReset()
  notifyFailed.mockReset()
})

describe('whatsapp inbound — contact vs lead cascade', () => {
  it('organic unknown inbound stores a leadless conversation and never creates a lead', async () => {
    const res = await POST(signed(inboundPayload()) as never)
    expect(res.status).toBe(200)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound).toHaveBeenCalledTimes(1)
    expect(ingestInbound.mock.calls[0][0].leadId).toBeNull()
    // Task 13: a non-personal Contact is answered automatically. It is still not
    // a Lead — promotion is a separate decision driven by business intent.
    expect(runKick).toHaveBeenCalledWith({ delaySeconds: 0, limit: 5 })
  })

  it('a personal conversation is never kicked, even when a message is stored', async () => {
    getMemory.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: null,
      isPersonal: true,
      customerWaId: '972501111111',
      customerName: 'Dana',
    })
    ingestInbound.mockResolvedValue({
      conversationId: 9,
      messageId: 11,
      inserted: true,
      autoResponseDelaySeconds: 0,
      ireEnqueued: false,
    })
    await POST(signed(inboundPayload()) as never)
    expect(createLead).not.toHaveBeenCalled()
    expect(runKick).not.toHaveBeenCalled()
  })

  it('unique existing phone match auto-links and does not create a lead', async () => {
    findMatches.mockResolvedValue([{ id: 42, name: 'דנה', status: 'new', phone: '972501111111' }])
    await POST(signed(inboundPayload()) as never)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound.mock.calls[0][0].leadId).toBe(42)
    expect(attach).toHaveBeenCalled()
    expect(runKick).toHaveBeenCalledWith({ delaySeconds: 0, limit: 5 })
  })

  it('multiple phone matches stay leadless — do not guess', async () => {
    findMatches.mockResolvedValue([
      { id: 42, name: 'א', status: 'new', phone: '972501111111' },
      { id: 43, name: 'ב', status: 'new', phone: '0501111111' },
    ])
    await POST(signed(inboundPayload()) as never)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound.mock.calls[0][0].leadId).toBeNull()
  })

  it('CTWA referral auto-creates a lead', async () => {
    createLead.mockResolvedValue({ id: 88 })
    await POST(signed(inboundPayload({ referral: { source_type: 'ad', ctwa_clid: 'c1' } })) as never)
    expect(createLead).toHaveBeenCalledTimes(1)
    expect(ingestInbound.mock.calls[0][0].leadId).toBe(88)
  })

  it('isPersonal wins over a later CTWA click', async () => {
    getMemory.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: null,
      isPersonal: true,
      customerWaId: '972501111111',
      customerName: 'Dana',
    })
    await POST(signed(inboundPayload({ referral: { source_type: 'ad' } })) as never)
    expect(createLead).not.toHaveBeenCalled()
    expect(ingestInbound.mock.calls[0][0].leadId).toBeNull()
  })

  it('remembered leadId attaches without creating another lead', async () => {
    getMemory.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: 55,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
    })
    await POST(signed(inboundPayload()) as never)
    expect(createLead).not.toHaveBeenCalled()
    expect(findMatches).not.toHaveBeenCalled()
    expect(ingestInbound.mock.calls[0][0].leadId).toBe(55)
    expect(runKick).toHaveBeenCalledWith({ delaySeconds: 0, limit: 5 })
  })

  it('Lead inbound with a delayed IRE job waits via the same kick helper', async () => {
    getMemory.mockResolvedValue({
      id: 9,
      agencyId: 69,
      leadId: 55,
      isPersonal: false,
      customerWaId: '972501111111',
      customerName: 'Dana',
    })
    ingestInbound.mockResolvedValue({
      conversationId: 9,
      messageId: 11,
      inserted: true,
      autoResponseDelaySeconds: 5,
      ireEnqueued: true,
    })
    await POST(signed(inboundPayload()) as never)
    expect(runKick).toHaveBeenCalledWith({ delaySeconds: 5, limit: 5 })
  })

  it('flag off keeps today\'s unconditional lead create', async () => {
    canUse.mockReturnValue(false)
    createLead.mockResolvedValue({ id: 1 })
    await POST(signed(inboundPayload()) as never)
    expect(createLead).toHaveBeenCalledTimes(1)
    expect(ingestInbound.mock.calls[0][0].leadId).toBe(1)
  })

  it('retry of the same webhook still returns 200 (ingest owns idempotency)', async () => {
    ingestInbound.mockResolvedValue({
      conversationId: 9,
      messageId: 11,
      inserted: false,
      autoResponseDelaySeconds: 0,
      ireEnqueued: false,
    })
    const res = await POST(signed(inboundPayload()) as never)
    expect(res.status).toBe(200)
    expect(createLead).not.toHaveBeenCalled()
    expect(runKick).not.toHaveBeenCalled()
  })
})
