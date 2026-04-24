/**
 * /api/payments/grow — webhook integration tests.
 *
 * Strategy: REAL database, REAL token verification, REAL idempotency via
 * the unique constraint on payments.transactionId. Only Next.js infra is
 * mocked. Each test uses a freshly-seeded agency on the 'free' plan and
 * cleans up after itself.
 */
import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { signToken } from '@/lib/payments/token'
import { POST } from '@/app/api/payments/grow/route'
import { GET as UPGRADE_GET } from '@/app/api/payments/upgrade/route'
import { requireUser } from '@/lib/requireUser'

vi.mock('@/lib/requireUser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return { ...actual, requireUser: vi.fn() }
})

const TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const WEBHOOK_SECRET = 'test_webhook_secret_cccccccccccccccccccccccccccccccc'
const PAYMENT_LINK = 'https://pay.grow.link/test-link-id'
const APP_HOST = 'localhost:3000'

const TEST_TAG = '__test_payments_' + Date.now() + '_'
let agencyIds: number[] = []

beforeAll(async () => {
  process.env.APP_ENV = 'production'
  process.env.GROW_MODE = 'production'
  process.env.APP_HOST = APP_HOST
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
})

afterAll(async () => {
  if (agencyIds.length) {
    await db('payments').whereIn('agencyId', agencyIds).delete()
    await db('agencies').whereIn('id', agencyIds).delete()
  }
  await db.destroy()
})

beforeEach(async () => {
  process.env.APP_ENV = 'production'
  process.env.GROW_MODE = 'production'
  process.env.APP_HOST = APP_HOST
  process.env.GROW_TOKEN_SECRET = TOKEN_SECRET
  process.env.GROW_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.GROW_PAYMENT_LINK = PAYMENT_LINK
  vi.mocked(requireUser).mockReset()
})

afterEach(async () => {
  if (agencyIds.length) {
    await db('payments').whereIn('agencyId', agencyIds).delete()
    await db('agencies').whereIn('id', agencyIds).delete()
    agencyIds = []
  }
})

async function seedAgency(): Promise<number> {
  const [row] = await db('agencies')
    .insert({ name: TEST_TAG + Math.random().toString(36).slice(2, 8), plan: 'free' })
    .returning('id')
  const id = typeof row === 'object' ? row.id : row
  agencyIds.push(id)
  return id
}

function buildReq(opts: { body: unknown; signature?: string | null; bodyOverride?: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: APP_HOST }
  if (opts.signature !== null) headers['x-grow-signature'] = opts.signature ?? WEBHOOK_SECRET
  return new NextRequest('http://localhost:3000/api/payments/grow', {
    method: 'POST',
    headers,
    body: opts.bodyOverride ?? JSON.stringify(opts.body),
  })
}

describe('POST /api/payments/grow — happy path', () => {
  it('upgrades agency to PRO and inserts a payment row', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_happy_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, status: 'success', external_id: externalId } }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    expect(agency.planReason).toBe(`grow:${transactionId}`)

    const payment = await db('payments').where({ transactionId }).first()
    expect(payment).toBeTruthy()
    expect(payment.agencyId).toBe(agencyId)
  })

  it('supports nested { data: {...} } payload shape', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_nested_' + Date.now()

    const res = await POST(buildReq({ body: { data: { transactionId, status: 'success', external_id: externalId } } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })
})

describe('POST /api/payments/grow — idempotency', () => {
  it('returns duplicate=true on second delivery and does NOT write twice', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_dup_' + Date.now()
    const payload = { transactionId, status: 'success', external_id: externalId }

    const first = await POST(buildReq({ body: payload }))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true })

    const second = await POST(buildReq({ body: payload }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, duplicate: true })

    const rows = await db('payments').where({ transactionId })
    expect(rows).toHaveLength(1)
  })

  it('survives concurrent duplicate deliveries (race)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_race_' + Date.now()
    const payload = { transactionId, status: 'success', external_id: externalId }

    const [a, b] = await Promise.all([POST(buildReq({ body: payload })), POST(buildReq({ body: payload }))])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 200])

    const rows = await db('payments').where({ transactionId })
    expect(rows).toHaveLength(1)
  })
})

describe('POST /api/payments/grow — security', () => {
  it('rejects production webhooks when host does not match APP_HOST', async () => {
    process.env.APP_HOST = 'socialcrm.example'
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_host_mismatch_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, status: 'success', external_id: externalId } }))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Webhook misconfigured')
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects when GROW_WEBHOOK_SECRET is missing', async () => {
    delete process.env.GROW_WEBHOOK_SECRET
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_missing_secret_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, status: 'success', external_id: externalId } }))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Server misconfigured')
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects local-environment webhooks before touching DB', async () => {
    process.env.APP_ENV = 'local'
    process.env.GROW_MODE = 'sandbox'
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_local_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, status: 'success', external_id: externalId } }))

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Webhook disabled')
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects request with no signature header (401)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)

    const res = await POST(
      buildReq({
        body: { transactionId: 'tx_nosig', status: 'success', external_id: externalId },
        signature: null,
      }),
    )

    expect(res.status).toBe(401)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects request with wrong signature (401) and does not touch DB', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)

    const res = await POST(
      buildReq({
        body: { transactionId: 'tx_badsig', status: 'success', external_id: externalId },
        signature: 'wrong_secret_' + 'x'.repeat(40),
      }),
    )

    expect(res.status).toBe(401)
    const payments = await db('payments').where({ transactionId: 'tx_badsig' })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects forged external_id (no valid HMAC) with 400', async () => {
    const agencyId = await seedAgency()
    // Attacker constructs a JSON-looking blob — without GROW_TOKEN_SECRET they cannot sign it
    const forged = Buffer.from(JSON.stringify({ a: agencyId, t: Date.now() })).toString('base64url') + '.fake_sig'

    const res = await POST(buildReq({ body: { transactionId: 'tx_forge', status: 'success', external_id: forged } }))

    expect(res.status).toBe(400)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('rejects expired token with 400', async () => {
    const agencyId = await seedAgency()
    // Hand-craft an expired but signed token
    const { createHmac } = await import('crypto')
    const payloadB64 = Buffer.from(JSON.stringify({ a: agencyId, t: Date.now() - 60 * 60 * 1000 - 1000 })).toString('base64url')
    const sig = createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url')
    const expired = `${payloadB64}.${sig}`

    const res = await POST(buildReq({ body: { transactionId: 'tx_exp', status: 'success', external_id: expired } }))

    expect(res.status).toBe(400)
  })
})

describe('POST /api/payments/grow — validation', () => {
  it('returns 400 on malformed JSON', async () => {
    const res = await POST(buildReq({ body: {}, bodyOverride: '{not json' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when transactionId is missing', async () => {
    const externalId = signToken(await seedAgency())
    const res = await POST(buildReq({ body: { status: 'success', external_id: externalId } }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when external_id is missing', async () => {
    const res = await POST(buildReq({ body: { transactionId: 'tx_x', status: 'success' } }))
    expect(res.status).toBe(400)
  })

  it('ignores non-success status (200, no DB writes)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_pending_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, status: 'pending', external_id: externalId } }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: true })

    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })
})

describe('Full flow integration', () => {
  it('upgrade route → extract external_id → webhook → DB upgraded', async () => {
    const agencyId = await seedAgency()
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId } as any)

    // 1. User clicks upgrade
    const upgradeRes = await UPGRADE_GET(
      new NextRequest('http://localhost:3000/api/payments/upgrade', { method: 'GET', headers: { host: APP_HOST } }),
    )
    expect(upgradeRes.status).toBe(302)
    const growUrl = new URL(upgradeRes.headers.get('location')!)
    const externalId = growUrl.searchParams.get('external_id')!
    expect(externalId).toBeTruthy()

    // 2. Grow processes payment, fires webhook back at us with the same external_id
    const transactionId = 'tx_e2e_' + Date.now()
    const webhookRes = await POST(buildReq({ body: { transactionId, status: 'success', external_id: externalId } }))
    expect(webhookRes.status).toBe(200)

    // 3. Side effects observable in DB
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    const payment = await db('payments').where({ transactionId }).first()
    expect(payment.agencyId).toBe(agencyId)
  })
})
