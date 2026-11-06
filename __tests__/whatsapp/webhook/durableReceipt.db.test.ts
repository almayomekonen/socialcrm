/**
 * Durable WhatsApp webhook receipt, end to end against the real route and a real
 * database: signed POST → receipt → acknowledgement → worker → message rows.
 *
 * Covers: acknowledgement only after the receipt commits; a failed receipt write is
 * 503 with nothing half-written and no fallback; duplicate and CONCURRENT delivery; a
 * processing failure retried with backoff; a worker that dies holding the lease; a
 * terminal failure and its operator requeue; per-customer ordering; tenancy when a
 * number moves agency; unknown numbers; multi-entry payloads; switching the kill switch
 * in both directions without double processing; direct-mode refusal; the cron route;
 * and no phone number or message text in the logs.
 *
 * Synthetic data only. Meta is never called; the auto-response drain is stubbed.
 */
import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  afterWork: [] as Promise<unknown>[],
  notPersisted: 0,
  failRecord: false,
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  // Capture post-response work instead of running it, so each test decides when the worker runs.
  return { ...actual, after: (_fn: () => unknown) => void h.afterWork.push(Promise.resolve()) }
})
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({ runAutoResponseKick: vi.fn(async () => ({})) }))
vi.mock('@/lib/whatsapp/handleInboundWebhookMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/handleInboundWebhookMessage')>()
  return {
    ...actual,
    handleInboundWebhookMessage: vi.fn(async (...a: Parameters<typeof actual.handleInboundWebhookMessage>) => {
      if (h.notPersisted > 0) {
        h.notPersisted--
        return { kick: false, delaySeconds: 0, persisted: false }
      }
      return actual.handleInboundWebhookMessage(...a)
    }),
  }
})
vi.mock('@/db/whatsappWebhookEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/whatsappWebhookEvents')>()
  return {
    ...actual,
    recordWhatsappEvents: vi.fn(async (...a: Parameters<typeof actual.recordWhatsappEvents>) => {
      if (h.failRecord) throw new Error('simulated receipt write failure')
      return actual.recordWhatsappEvents(...a)
    }),
  }
})

import { db } from '@/config/db'
import { claimWhatsappEvents, requeueFailedWhatsappEvents } from '@/db/whatsappWebhookEvents'
import { runWhatsappWebhookWorker } from '@/lib/whatsapp/webhook/worker'

const SECRET = 'durable-receipt-test-secret'
const PN = '__durable_pn_a__'
const PN_B = '__durable_pn_b__'
const CUSTOMER = '972521110001'
const CUSTOMER_2 = '972521110002'
let agencyA = 0
let agencyB = 0
let userA = 0
let n = 0

const { POST } = await import('@/app/api/webhooks/whatsapp/route')
const { GET: CRON } = await import('@/app/api/cron/whatsapp-webhook-events/route')

function signedReq(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  return new Request('https://example.test/api/webhooks/whatsapp', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body: raw })
}
const message = (id: string, text: string, from = CUSTOMER) => ({ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } })
const delivery = (msgs: Record<string, unknown>[], phone = PN, extra: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, contacts: [{ wa_id: CUSTOMER, profile: { name: 'בדיקה' } }], messages: msgs, ...extra } }] }],
})
const post = (body: unknown) => POST(signedReq(body) as never)
const drain = () => runWhatsappWebhookWorker({ workerId: `test-${++n}`, kick: async () => ({}) as never })
const receipts = (phone = PN) => db('whatsapp_webhook_events').where({ phoneNumberId: phone }).orderBy('id')
const inboundTexts = (agencyId: number) =>
  db('inbox_messages').where({ agencyId, direction: 'inbound' }).orderBy('sequence').pluck('text') as Promise<string[]>
const makeDue = () => db('whatsapp_webhook_events').whereIn('phoneNumberId', [PN, PN_B]).where({ status: 'received' }).update({ nextAttemptAt: db.fn.now() })

async function wipe() {
  for (const agencyId of [agencyA, agencyB]) {
    const convIds = (await db('inbox_conversations').where({ agencyId }).select('id')).map((r) => Number(r.id))
    await db('conversation_analysis_jobs').whereIn('conversationId', convIds).del()
    for (const t of ['notification_jobs', 'notifications', 'analytics_events', 'auto_response_jobs', 'conversation_ai_state', 'inbox_messages', 'inbox_participants', 'inbox_conversations']) {
      const cols = await db(t).columnInfo().catch(() => ({}))
      if ('agencyId' in cols) await db(t).where({ agencyId }).del()
    }
    await db('tasks').whereIn('clientId', db('clients').select('id').where({ agencyId })).del()
    await db('clients').where({ agencyId }).del()
  }
  await db('whatsapp_webhook_events').whereIn('phoneNumberId', [PN, PN_B, '__durable_unknown__']).del()
}

beforeAll(async () => {
  process.env.META_APP_SECRET = SECRET
  const [a] = await db('agencies').insert({ name: '__durable_a__', autoResponseEnabled: false }).returning('id')
  const [b] = await db('agencies').insert({ name: '__durable_b__', autoResponseEnabled: false }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [u] = await db('users').insert({ firstName: 'D', role: 'ADMIN', agencyId: agencyA }).returning('id')
  userA = Number(u.id)
  const [ub] = await db('users').insert({ firstName: 'E', role: 'ADMIN', agencyId: agencyB }).returning('id')
  await db('whatsapp_connections').insert([
    { user_id: userA, agency_id: agencyA, phone_number_id: PN, access_token: 'x' },
    { user_id: Number(ub.id), agency_id: agencyB, phone_number_id: PN_B, access_token: 'x' },
  ])
})

beforeEach(async () => {
  h.afterWork = []
  h.notPersisted = 0
  h.failRecord = false
  delete process.env.WA_WEBHOOK_DIRECT_PROCESSING
  await wipe()
})

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  await wipe()
  await db('whatsapp_connections').whereIn('phone_number_id', [PN, PN_B]).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
  delete process.env.META_APP_SECRET
  await db.destroy()
})

describe('acknowledge only after the receipt commits', () => {
  it('records the receipt, answers 200, and applies nothing inside the request', async () => {
    const res = await post(delivery([message('wamid.d1', 'שלום')]))
    expect(res.status).toBe(200)
    const rows = await receipts()
    expect(rows.map((r) => [r.kind, r.eventKey, r.status, Number(r.agencyId), r.orderingKey])).toEqual([['message', 'msg:wamid.d1', 'received', agencyA, CUSTOMER]])
    expect(await inboundTexts(agencyA)).toEqual([])
    const summary = await drain()
    expect(summary).toMatchObject({ processed: 1, retried: 0 })
    expect(await inboundTexts(agencyA)).toEqual(['שלום'])
    expect((await receipts())[0]).toMatchObject({ status: 'processed', outcome: 'stored' })
  })

  it('a receipt that cannot be written answers 503, writes nothing, and does NOT fall back to direct processing', async () => {
    h.failRecord = true
    const res = await post(delivery([message('wamid.d2', 'x')]))
    expect(res.status).toBe(503)
    expect(await receipts()).toEqual([])
    expect(await inboundTexts(agencyA)).toEqual([])
    // Meta's redelivery, once storage is back, is accepted normally.
    h.failRecord = false
    expect((await post(delivery([message('wamid.d2', 'x')]))).status).toBe(200)
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['x'])
  })

  it('a bad signature is refused before anything is recorded', async () => {
    const res = await POST(signedReq(delivery([message('wamid.d3', 'x')]), 'wrong-secret') as never)
    expect(res.status).toBe(403)
    expect(await receipts()).toEqual([])
  })
})

describe('duplicate and concurrent delivery', () => {
  it('a redelivered payload is one receipt and one message', async () => {
    const body = delivery([message('wamid.dup', 'פעם אחת')])
    expect((await post(body)).status).toBe(200)
    expect((await post(body)).status).toBe(200)
    expect(await receipts()).toHaveLength(1)
    await drain()
    expect((await post(body)).status).toBe(200)
    await drain()
    expect(await receipts()).toHaveLength(1)
    expect(await inboundTexts(agencyA)).toEqual(['פעם אחת'])
  })

  it('five concurrent deliveries of the same payload, then two concurrent workers: one receipt, one message, one lead', async () => {
    const body = delivery([message('wamid.conc', 'במקביל')])
    const results = await Promise.all(Array.from({ length: 5 }, () => post(body)))
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(await receipts()).toHaveLength(1)
    await Promise.all([drain(), drain()])
    expect(await inboundTexts(agencyA)).toEqual(['במקביל'])
    expect(Number((await db('clients').where({ agencyId: agencyA }).count('id as c').first())?.c)).toBe(1)
  })
})

describe('failure, retry and recovery', () => {
  it('a processing failure is retried with backoff and applied exactly once', async () => {
    await post(delivery([message('wamid.retry', 'אחרי ניסיון')]))
    h.notPersisted = 1
    expect(await drain()).toMatchObject({ retried: 1, processed: 0 })
    const failed = (await receipts())[0]
    expect(failed).toMatchObject({ status: 'received', attempts: 1, lastError: 'message_not_persisted' })
    expect(new Date(failed.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())
    // Not due yet: the cron leaves it alone.
    expect(await drain()).toMatchObject({ claimed: 0 })
    await makeDue()
    expect(await drain()).toMatchObject({ processed: 1 })
    expect(await inboundTexts(agencyA)).toEqual(['אחרי ניסיון'])
  })

  it('a worker that dies holding the lease is recovered after the lease expires, and applied once', async () => {
    await post(delivery([message('wamid.crash', 'שרד')]))
    const [leased] = await claimWhatsappEvents('worker-that-died', 10)
    expect(leased).toBeDefined()
    // While the lease is live, nobody else takes it.
    expect(await drain()).toMatchObject({ claimed: 0 })
    await db('whatsapp_webhook_events').where({ id: leased.id }).update({ lockedAt: new Date(Date.now() - 10 * 60_000) })
    expect(await drain()).toMatchObject({ reclaimed: 1, processed: 1 })
    expect(await inboundTexts(agencyA)).toEqual(['שרד'])
  })

  it('an event that keeps failing ends terminal `failed`, kept, and an operator requeue applies it', async () => {
    await post(delivery([message('wamid.poison', 'בסוף')]))
    await db('whatsapp_webhook_events').where({ phoneNumberId: PN }).update({ maxAttempts: 2 })
    h.notPersisted = 99
    await drain()
    await makeDue()
    await drain()
    const [row] = await receipts()
    expect(row).toMatchObject({ status: 'failed', attempts: 2, lastError: 'message_not_persisted' })
    h.notPersisted = 0
    await makeDue()
    expect(await drain()).toMatchObject({ claimed: 0 })
    expect(await requeueFailedWhatsappEvents({ ids: [Number(row.id)] })).toBe(1)
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['בסוף'])
  })
})

describe('ordering and tenancy', () => {
  it("one customer's events apply in arrival order, even when the first one has to be retried", async () => {
    await post(delivery([message('wamid.o1', 'ראשון')]))
    await post(delivery([message('wamid.o2', 'שני')]))
    h.notPersisted = 1
    await drain()
    // The first failed and is backing off; the second must wait behind it.
    expect(await inboundTexts(agencyA)).toEqual([])
    expect((await receipts()).map((r) => r.status)).toEqual(['received', 'received'])
    await makeDue()
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['ראשון', 'שני'])
  })

  it('a different customer is not held up by another customer’s retry', async () => {
    await post(delivery([message('wamid.p1', 'לקוח 1')]))
    await post(delivery([message('wamid.p2', 'לקוח 2', CUSTOMER_2)]))
    h.notPersisted = 1
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['לקוח 2'])
  })

  it('a number that moved to another agency after receipt is ignored, never applied to the new owner', async () => {
    await post(delivery([message('wamid.moved', 'לא להעביר')]))
    await db('whatsapp_connections').where({ phone_number_id: PN }).update({ agency_id: agencyB })
    try {
      expect(await drain()).toMatchObject({ ignored: 1, processed: 0 })
      expect((await receipts())[0]).toMatchObject({ status: 'ignored', outcome: 'connection_changed_agency' })
      expect(await inboundTexts(agencyA)).toEqual([])
      expect(await inboundTexts(agencyB)).toEqual([])
    } finally {
      await db('whatsapp_connections').where({ phone_number_id: PN }).update({ agency_id: agencyA })
    }
  })

  it('an unknown number is acknowledged and recorded nowhere', async () => {
    expect((await post(delivery([message('wamid.unknown', 'x')], '__durable_unknown__'))).status).toBe(200)
    expect(await receipts('__durable_unknown__')).toEqual([])
  })

  it('every entry of a multi-entry delivery is recorded, each under its own agency', async () => {
    const body = { entry: [...delivery([message('wamid.m1', 'א')]).entry, ...delivery([message('wamid.m2', 'ב', CUSTOMER_2)], PN_B).entry] }
    expect((await post(body)).status).toBe(200)
    expect((await receipts()).map((r) => Number(r.agencyId))).toEqual([agencyA])
    expect((await receipts(PN_B)).map((r) => Number(r.agencyId))).toEqual([agencyB])
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['א'])
    expect(await inboundTexts(agencyB)).toEqual(['ב'])
  })
})

describe('the kill switch', () => {
  it('direct mode applies inside the request, records no receipt, and emits the alert line', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    const warn = vi.spyOn(console, 'warn')
    expect((await post(delivery([message('wamid.direct', 'ישיר')]))).status).toBe(200)
    expect(await receipts()).toEqual([])
    expect(await inboundTexts(agencyA)).toEqual(['ישיר'])
    expect(warn.mock.calls.some((c) => c[0] === '[wa-webhook] direct_mode_active')).toBe(true)
  })

  it('direct mode refuses (503) an event that was not stored, so Meta redelivers it', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    h.notPersisted = 1
    expect((await post(delivery([message('wamid.direct-fail', 'שוב')]))).status).toBe(503)
    expect((await post(delivery([message('wamid.direct-fail', 'שוב')]))).status).toBe(200)
    expect(await inboundTexts(agencyA)).toEqual(['שוב'])
  })

  it('durable → direct: a receipt recorded before the switch still drains, and a redelivery in direct mode does not duplicate it', async () => {
    const body = delivery([message('wamid.switch1', 'פעם אחת בלבד')])
    await post(body)
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    expect((await post(body)).status).toBe(200)
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['פעם אחת בלבד'])
    expect((await receipts())[0].status).toBe('processed')
  })

  it('direct → durable: a redelivery of an event already applied directly is absorbed', async () => {
    process.env.WA_WEBHOOK_DIRECT_PROCESSING = '1'
    const body = delivery([message('wamid.switch2', 'רק פעם')])
    await post(body)
    delete process.env.WA_WEBHOOK_DIRECT_PROCESSING
    expect((await post(body)).status).toBe(200)
    await drain()
    expect(await inboundTexts(agencyA)).toEqual(['רק פעם'])
  })
})

describe('the cron backstop', () => {
  const cron = (auth?: string) => CRON(new Request('https://example.test/api/cron/whatsapp-webhook-events', { headers: auth ? { authorization: `Bearer ${auth}` } : {} }) as never)

  it('refuses without the cron secret, and drains with it, reporting counts only', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-test')
    vi.stubEnv('AUTOMATION_API_KEY', undefined)
    try {
      await post(delivery([message('wamid.cron', 'מהקרון')]))
      expect((await cron()).status).toBe(403)
      expect((await cron('wrong')).status).toBe(403)
      const res = await cron('cron-secret-for-test')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, mode: 'durable', processed: 1 })
      expect(JSON.stringify(body)).not.toContain(CUSTOMER)
      expect(await inboundTexts(agencyA)).toEqual(['מהקרון'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('logs the alert line on every run while the kill switch is on', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-test')
    vi.stubEnv('AUTOMATION_API_KEY', undefined)
    vi.stubEnv('WA_WEBHOOK_DIRECT_PROCESSING', '1')
    const warn = vi.spyOn(console, 'warn')
    try {
      expect((await cron('cron-secret-for-test')).status).toBe(200)
      expect(warn.mock.calls.some((c) => c[0] === '[wa-webhook] direct_mode_active' && String(c[1]).includes('cron'))).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('logs', () => {
  it('no [wa-webhook] line carries a phone number or message text', async () => {
    const lines: string[] = []
    const capture = (...a: unknown[]) => void lines.push(a.map(String).join(' '))
    vi.spyOn(console, 'log').mockImplementation(capture)
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)
    await post(delivery([message('wamid.log', 'טקסט פרטי')]))
    h.notPersisted = 1
    await drain()
    const ours = lines.filter((l) => l.startsWith('[wa-webhook]'))
    expect(ours.length).toBeGreaterThan(0)
    for (const l of ours) {
      expect(l).not.toContain(CUSTOMER)
      expect(l).not.toContain('טקסט פרטי')
      expect(l).not.toContain(PN)
    }
  })
})
