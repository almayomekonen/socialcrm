/**
 * Messenger webhook reliability, against a real Postgres with REAL failures
 * (temporary triggers that raise inside the database — no mocked db).
 *
 *  · receipt is durable before processing; duplicate and retried deliveries
 *    produce one receipt and one message;
 *  · a failed receipt write answers 503 (never a false 200) while the Lead Ads
 *    lead in the same delivery is created exactly once across the redelivery;
 *  · a failing worker backs off, reaches a terminal `failed` state, and an
 *    operator requeue recovers the message exactly once;
 *  · a lease left by a dead worker is reclaimed;
 *  · a receipt is never stored under a different agency than it was received for.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerReliability.db.test.ts
 */
import { createHmac } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'rel-secret'
  process.env.META_APP_ID = 'APPREL'
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/system/createSystemTask', () => ({ createSystemTask: vi.fn() }))
vi.mock('@/lib/quota', () => ({
  getQuotaStatus: vi.fn(async () => ({ plan: 'pro', limit: null, used: 0, overQuotaCount: 0 })),
}))
vi.mock('@/lib/analytics/track', () => ({ trackFirstRealLeadOnce: vi.fn(), track: vi.fn(), trackOncePerAgency: vi.fn() }))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn() }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn() }))
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: vi.fn(async () => ({ enqueued: false })) }))
vi.mock('@/db/leadAttribution', () => ({ recordLeadAttribution: vi.fn() }))

import { db } from '@/config/db'
import { POST } from '@/app/api/webhooks/facebook/route'
import { runMessengerEventWorker } from '@/lib/facebook/messenger/eventWorker'
import {
  claimMessengerEvents,
  pruneSettledMessengerEvents,
  reclaimStaleMessengerEvents,
  requeueFailedMessengerEvents,
} from '@/db/messengerWebhookEvents'

const PAGE = '__rel_page__'
let agencyA = 0
let agencyB = 0
let seq = 0

function signed(body: unknown) {
  const raw = JSON.stringify(body)
  return new Request('https://getsocialcrm.com/api/webhooks/facebook', {
    method: 'POST',
    body: raw,
    headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'rel-secret').update(raw).digest('hex') },
  }) as never
}

const message = (mid: string, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  entry: [
    {
      id: PAGE,
      time: 1,
      messaging: [{ sender: { id: 'PSID_REL' }, recipient: { id: PAGE }, timestamp: Date.parse('2026-09-15T08:00:00Z'), message: { mid, text: 'שלום' } }],
      ...extra,
    },
  ],
})

const receipts = () => db('messenger_webhook_events').where({ pageId: PAGE }).orderBy('id')
const messages = () => db('messenger_messages').where({ pageId: PAGE })

async function withTrigger(table: string, fn: () => Promise<void>) {
  const name = `__fail_${table}__`
  await db.raw(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END $$ LANGUAGE plpgsql`)
  await db.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`)
  try {
    await fn()
  } finally {
    await db.raw(`DROP TRIGGER IF EXISTS ${name} ON ${table}`)
    await db.raw(`DROP FUNCTION IF EXISTS ${name}()`)
  }
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_rel_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_rel_b__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = `${agencyA},${agencyB}`
  const [u] = await db('users').insert({ firstName: 'Rel', role: 'ADMIN', agencyId: agencyA, email: `rel-${Date.now()}@example.test` }).returning('id')
  await db('facebook_pages').insert({
    user_id: Number(u.id),
    agency_id: agencyA,
    page_id: PAGE,
    page_name: 'Rel',
    page_access_token: 'x',
    granted_scopes: JSON.stringify(['pages_messaging', 'pages_manage_metadata', 'pages_show_list', 'leads_retrieval']),
  })
})

beforeEach(async () => {
  await db('facebook_pages').where({ page_id: PAGE }).update({ agency_id: agencyA })
  await db('messenger_webhook_events').where({ pageId: PAGE }).del()
  await db('messenger_messages').where({ pageId: PAGE }).del()
  await db('messenger_conversations').where({ pageId: PAGE }).del()
  await db('clients').whereIn('agencyId', [agencyA, agencyB]).del()
})

afterAll(async () => {
  await db('messenger_webhook_events').where({ pageId: PAGE }).del()
  await db('messenger_messages').where({ pageId: PAGE }).del()
  await db('messenger_conversations').where({ pageId: PAGE }).del()
  await db('clients').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('facebook_pages').where({ page_id: PAGE }).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
  await db.destroy()
})

describe('durable receipt', () => {
  it('E1: the receipt exists before any processing; the worker then stores the message', async () => {
    expect((await POST(signed(message('mid_e1')))).status).toBe(200)
    const [r] = await receipts()
    expect(r).toMatchObject({ status: 'received', agencyId: agencyA, eventKey: 'mid:mid_e1', kind: 'inbound', attempts: 0 })
    expect(await messages()).toHaveLength(0)

    const summary = await runMessengerEventWorker({ workerId: 'e1' })
    expect(summary).toMatchObject({ claimed: 1, processed: 1, failed: 0 })
    expect((await receipts())[0]).toMatchObject({ status: 'processed', outcome: 'stored' })
    expect(await messages()).toHaveLength(1)
  })

  it('E2: duplicate deliveries (before and after processing) → one receipt, one message', async () => {
    await POST(signed(message('mid_e2')))
    await POST(signed(message('mid_e2')))
    expect(await receipts()).toHaveLength(1)
    await runMessengerEventWorker({ workerId: 'e2' })
    await POST(signed(message('mid_e2')))
    await runMessengerEventWorker({ workerId: 'e2b' })
    expect(await receipts()).toHaveLength(1)
    expect(await messages()).toHaveLength(1)
  })

  it('E3: receipt write fails → 503, nothing claimed; the lead in the same delivery is created once across the redelivery', async () => {
    const leadgenId = `77${Date.now()}${seq++}`
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ field_data: [{ name: 'full_name', values: ['דנה לוי'] }, { name: 'phone_number', values: [`05255${seq}0001`] }] }),
      text: async () => '{}',
    })) as unknown as typeof fetch
    const delivery = message('mid_e3', { changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId } }] })

    await withTrigger('messenger_webhook_events', async () => {
      const res = await POST(signed(delivery))
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ ok: false, error: 'messenger_receipt_failed' })
    })
    expect(await receipts()).toHaveLength(0)
    const [{ n: leadsAfterFirst }] = await db('clients').where({ agencyId: agencyA }).count({ n: '*' })
    expect(Number(leadsAfterFirst)).toBe(1) // Lead Ads still processed in the failed delivery

    // Meta redelivers because of the 503.
    expect((await POST(signed(delivery))).status).toBe(200)
    expect(await receipts()).toHaveLength(1)
    const [{ n: leadsAfterRedelivery }] = await db('clients').where({ agencyId: agencyA }).count({ n: '*' })
    expect(Number(leadsAfterRedelivery)).toBe(1) // not duplicated by the redelivery
    await runMessengerEventWorker({ workerId: 'e3' })
    expect(await messages()).toHaveLength(1)
  })

  it('E4: a Page with no connection, or an agency outside the rollout, is acknowledged and not recorded', async () => {
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = String(agencyB)
    try {
      expect((await POST(signed(message('mid_e4')))).status).toBe(200)
      expect(await receipts()).toHaveLength(0)
    } finally {
      process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = `${agencyA},${agencyB}`
    }
    const unknown = { object: 'page', entry: [{ id: '__no_such_page__', messaging: [{ sender: { id: 'U' }, recipient: { id: '__no_such_page__' }, message: { mid: 'x' } }] }] }
    expect((await POST(signed(unknown))).status).toBe(200)
    expect(await db('messenger_webhook_events').where({ pageId: '__no_such_page__' })).toHaveLength(0)
  })
})

describe('worker failures and recovery', () => {
  it('E5: processing fails → backoff with a content-free error → terminal failed → requeue → stored exactly once', async () => {
    await POST(signed(message('mid_e5')))
    await withTrigger('messenger_messages', async () => {
      const first = await runMessengerEventWorker({ workerId: 'e5' })
      expect(first).toMatchObject({ claimed: 1, failed: 1 })
      let [r] = await receipts()
      expect(r).toMatchObject({ status: 'received', attempts: 1 })
      expect(String(r.lastError)).toContain('sqlstate=P0001')
      expect(String(r.lastError)).not.toContain('שלום')
      expect(new Date(r.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())

      // Not due yet: a backstop run does not touch it.
      expect((await runMessengerEventWorker({ workerId: 'e5b' })).claimed).toBe(0)

      await db('messenger_webhook_events').where({ id: r.id }).update({ nextAttemptAt: db.fn.now(), maxAttempts: 2 })
      await runMessengerEventWorker({ workerId: 'e5c' })
      ;[r] = await receipts()
      expect(r).toMatchObject({ status: 'failed', attempts: 2 })
      expect(await messages()).toHaveLength(0)
    })

    const [failed] = await receipts()
    expect(await requeueFailedMessengerEvents({ ids: [Number(failed.id)] })).toBe(1)
    expect(await runMessengerEventWorker({ workerId: 'e5d' })).toMatchObject({ processed: 1 })
    expect((await receipts())[0]).toMatchObject({ status: 'processed', attempts: 1 })
    expect(await messages()).toHaveLength(1)

    // A second requeue of a processed receipt is a no-op; re-processing never duplicates.
    expect(await requeueFailedMessengerEvents({ ids: [Number(failed.id)] })).toBe(0)
  })

  it('E6: a worker that died holding the lease — reclaimed and processed; attempts are not refunded', async () => {
    await POST(signed(message('mid_e6')))
    const claimed = await claimMessengerEvents('dead-worker', 10)
    expect(claimed).toHaveLength(1)
    expect((await runMessengerEventWorker({ ids: [claimed[0].id], workerId: 'kick' })).claimed).toBe(0) // leased elsewhere

    expect(await reclaimStaleMessengerEvents(0, Date.now() + 1000)).toBe(1)
    const summary = await runMessengerEventWorker({ workerId: 'e6' })
    expect(summary.processed).toBe(1)
    expect((await receipts())[0]).toMatchObject({ status: 'processed', attempts: 2 })
    expect(await messages()).toHaveLength(1)
  })

  it('E7: a Page that changed agency between receipt and processing → ignored, stored under neither agency', async () => {
    await POST(signed(message('mid_e7')))
    await db('facebook_pages').where({ page_id: PAGE }).update({ agency_id: agencyB })
    await runMessengerEventWorker({ workerId: 'e7' })
    expect((await receipts())[0]).toMatchObject({ status: 'ignored', outcome: 'tenant_changed', agencyId: agencyA })
    expect(await messages()).toHaveLength(0)
  })

  it('E8: retention prunes settled receipts only; failed receipts are kept for recovery', async () => {
    await POST(signed(message('mid_e8a')))
    await POST(signed(message('mid_e8b')))
    await runMessengerEventWorker({ workerId: 'e8' })
    const [a, b] = await receipts()
    await db('messenger_webhook_events').where({ id: a.id }).update({ processedAt: db.raw(`now() - interval '40 days'`) })
    await db('messenger_webhook_events').where({ id: b.id }).update({ status: 'failed', processedAt: db.raw(`now() - interval '40 days'`) })
    expect(await pruneSettledMessengerEvents(30)).toBe(1)
    expect((await receipts()).map((r) => r.status)).toEqual(['failed'])
  })
})
