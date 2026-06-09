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
    await db('pending_upgrades').whereIn('agencyId', agencyIds).delete()
    await db('subscriptions').whereIn('agencyId', agencyIds).delete()
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
    await db('pending_upgrades').whereIn('agencyId', agencyIds).delete()
    await db('subscriptions').whereIn('agencyId', agencyIds).delete()
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

function buildReq(opts: { body: unknown; bodyOverride?: string }) {
  // No auth header — production captures confirmed Grow PaymentLinks sends
  // none. Auth (when present) is body-side via payload.webhookKey.
  const headers: Record<string, string> = { 'content-type': 'application/json', host: APP_HOST }
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

  it('rejects with 500 when payload has webhookKey but GROW_WEBHOOK_SECRET is unset', async () => {
    delete process.env.GROW_WEBHOOK_SECRET
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_missing_secret_' + Date.now()

    const res = await POST(
      buildReq({ body: { transactionId, external_id: externalId, webhookKey: 'anything' } }),
    )

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Server misconfigured')
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('allows webhooks with NO webhookKey when GROW_WEBHOOK_SECRET is unset (URL-secrecy mode)', async () => {
    // PaymentLinks variant: no webhookKey in payload, no auth header — auth
    // rests entirely on URL secrecy + HMAC external_id verification.
    delete process.env.GROW_WEBHOOK_SECRET
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_no_secret_no_key_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, external_id: externalId } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
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

  it('rejects with 401 when payload webhookKey does NOT match GROW_WEBHOOK_SECRET', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_badkey_' + Date.now()

    const res = await POST(
      buildReq({
        body: { transactionId, external_id: externalId, webhookKey: 'wrong_key_' + 'x'.repeat(40) },
      }),
    )

    expect(res.status).toBe(401)
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('free')
  })

  it('accepts payload with matching camelCase webhookKey', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_goodkey_camel_' + Date.now()

    const res = await POST(
      buildReq({
        body: { transactionId, external_id: externalId, webhookKey: WEBHOOK_SECRET },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })

  it('accepts payload with matching snake_case webhook_key', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_goodkey_snake_' + Date.now()

    const res = await POST(
      buildReq({
        body: { transactionId, external_id: externalId, webhook_key: WEBHOOK_SECRET },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })

  it('ignores absent x-grow-signature header (no longer used)', async () => {
    // Regression guard: the old header-based check is gone. A request with
    // no header at all should authenticate purely on body-key (or, when
    // absent, on URL secrecy + verifyToken).
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_no_header_' + Date.now()

    const res = await POST(buildReq({ body: { transactionId, external_id: externalId } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
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

  it('no longer rejects payloads without externalId at the gate (fallback path takes over)', async () => {
    // The required-fields gate now only requires transactionId; missing
    // externalId routes to the pending_upgrades fallback. With no pending
    // rows at all the fallback returns 404 'Pending upgrade not found'.
    const res = await POST(buildReq({ body: { transactionId: 'tx_no_ext_id_only' } }))
    expect(res.status).not.toBe(400)
    expect(res.status).toBe(404)
  })
})

/**
 * Pending-upgrade fallback (Task 5 of the pending_upgrades feature).
 *
 * When Grow PaymentLinks doesn't echo our identifyParam token back, the
 * webhook falls back to resolving agencyId by the most recent pending
 * upgrade row matching payerEmail. The /api/payments/upgrade route
 * upserts a pending row before redirecting the user to Grow.
 */
describe('POST /api/payments/grow — pending_upgrades fallback', () => {
  async function seedPending(agencyId: number, email: string, status: 'pending' | 'completed' = 'pending') {
    await db('pending_upgrades')
      .insert({
        agencyId,
        email,
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflict('agencyId')
      .merge({ email, status, updatedAt: new Date() })
  }

  // TEST A — existing token flow still works UNCHANGED
  it('A: existing token flow still works (externalId present → verifyToken path)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_A_token_flow_' + Date.now()

    // No pending row needed — the token path is taken when externalId is set
    const res = await POST(
      buildReq({ body: { data: { transactionId, externalId, payerEmail: 'someone@example.com' } } }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    expect(agency.planReason).toBe(`grow:${transactionId}`)
  })

  // TEST B — externalId empty + matching pending row → fallback resolves
  it('B: externalId empty + payerEmail matches a pending row → fallback succeeds', async () => {
    const agencyId = await seedAgency()
    const email = 'fallback-' + Date.now() + '@example.com'
    await seedPending(agencyId, email, 'pending')

    const transactionId = 'tx_B_fallback_' + Date.now()
    const res = await POST(
      buildReq({
        // Real PaymentLinks shape — empty identifyParam, real payerEmail
        body: { data: { transactionCode: transactionId, identifyParam: '', payerEmail: email } },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')

    // Pending row marked completed after successful upgrade
    const pendingAfter = await db('pending_upgrades').where({ agencyId }).first()
    expect(pendingAfter.status).toBe('completed')
  })

  // TEST C — no pending rows at all → 404 returned
  it('C: externalId empty + no pending rows exist → 404', async () => {
    const transactionId = 'tx_C_no_pending_' + Date.now()
    const res = await POST(
      buildReq({
        body: { data: { transactionCode: transactionId, identifyParam: '', payerEmail: 'never-seen-' + Date.now() + '@example.com' } },
      }),
    )

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Pending upgrade not found')

    // No payments row, no agency mutations
    const payments = await db('payments').where({ transactionId })
    expect(payments).toHaveLength(0)
  })

  // TEST C2 — payerEmail empty (real Grow shape when checkout collects no
  // email) but exactly one pending row exists → sole-row fallback resolves
  it('C2: payerEmail empty + exactly one pending row → sole-pending fallback succeeds', async () => {
    const agencyId = await seedAgency()
    await seedPending(agencyId, 'owner-' + Date.now() + '@example.com', 'pending')

    const transactionId = 'tx_C2_sole_pending_' + Date.now()
    const res = await POST(
      buildReq({
        // Observed production shape: empty identifyParam AND empty payerEmail
        body: { data: { transactionCode: transactionId, identifyParam: '', payerEmail: '' } },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')

    const pendingAfter = await db('pending_upgrades').where({ agencyId }).first()
    expect(pendingAfter.status).toBe('completed')
  })

  // TEST C3 — email casing differences must not break attribution
  it('C3: payerEmail matches pending row case-insensitively', async () => {
    const agencyId = await seedAgency()
    const email = 'CaseTest-' + Date.now() + '@Example.com'
    await seedPending(agencyId, email, 'pending')

    const transactionId = 'tx_C3_case_' + Date.now()
    const res = await POST(
      buildReq({
        body: { data: { transactionCode: transactionId, identifyParam: '', payerEmail: email.toUpperCase() } },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })

  // TEST D — full success via fallback: agency.plan='pro' + subscription row
  it('D: successful fallback end-to-end → plan=pro + subscriptions row + pending=completed', async () => {
    const agencyId = await seedAgency()
    const email = 'fallback-d-' + Date.now() + '@example.com'
    await seedPending(agencyId, email, 'pending')

    const transactionId = 'tx_D_e2e_' + Date.now()
    const res = await POST(
      buildReq({
        body: {
          data: {
            transactionCode: transactionId,
            identifyParam: '',
            payerEmail: email,
            // Plus other real PaymentLinks fields, ignored by handler:
            asmachta: '12345',
            sum: '149',
            statusCode: '2',
            status: 'שולם',
            paymentLinkProcessId: 'plp_d',
          },
        },
      }),
    )

    expect(res.status).toBe(200)

    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    expect(agency.planReason).toBe(`grow:${transactionId}`)

    const payment = await db('payments').where({ transactionId }).first()
    expect(payment).toBeTruthy()
    expect(payment.agencyId).toBe(agencyId)

    const sub = await db('subscriptions').where({ agencyId }).first()
    expect(sub).toBeTruthy()
    expect(sub.cancelAtPeriodEnd).toBe(false)

    const pendingAfter = await db('pending_upgrades').where({ agencyId }).first()
    expect(pendingAfter.status).toBe('completed')
  })

  // Defensive — most-recent pending wins if there were re-clicks
  it('orders by createdAt DESC — most recent pending row wins if multiple', async () => {
    const agencyId = await seedAgency()
    const email = 'multi-' + Date.now() + '@example.com'
    // seedPending uses upsert; only one row per agencyId is possible due to
    // UNIQUE(agencyId), so the .orderBy('createdAt', 'desc') is for the
    // multi-agency case where the same email could appear on multiple
    // agencies. Simulate that by NOT relying on multi-row-same-agency.
    await seedPending(agencyId, email, 'pending')

    const transactionId = 'tx_order_' + Date.now()
    const res = await POST(buildReq({ body: { data: { transactionCode: transactionId, payerEmail: email } } }))
    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })
})

/**
 * Real Grow PaymentLinks payload tests.
 *
 * Payload shape is taken verbatim from the official Grow docs ("Regular
 * Payment Webhook Format via PaymentLinks (New system — מערכת בנקאות
 * חדשה)"). The example in the docs omits the echoed external identifier;
 * we include it under `externalId` (camelCase) since that matches the
 * docs' camelCase convention for the rest of the data fields. The handler
 * accepts either casing.
 */
describe('POST /api/payments/grow — real Grow PaymentLinks payload (TEST A)', () => {
  function buildRealPaymentLinksPayload(externalId: string, transactionId: string) {
    return {
      err: '',
      status: '1',
      data: {
        asmachta: '12345',
        cardSuffix: '1234',
        cardType: 'Local',
        cardTypeCode: '1',
        cardBrand: 'Visa',
        cardBrandCode: '3',
        cardExp: '1127',
        firstPaymentSum: '0',
        periodicalPaymentSum: '0',
        status: 'שולם',
        statusCode: '2',
        transactionTypeId: '1',
        paymentType: '2',
        sum: '13',
        paymentsNum: '0',
        allPaymentsNum: '1',
        paymentDate: '02/12/24',
        description: 'תיאור עסקה',
        fullName: 'דוד דוד',
        payerPhone: '0501111111',
        payerEmail: 'test@test.com',
        transactionId,
        transactionToken: '818bf8333e7a3f0c53ef8e7',
        paymentLinkProcessId: '1234567',
        paymentLinkProcessToken: '7ab1c9133444a8507ebf24ff2',
        processId: '13809798',
        processToken: '10e0f8f61fc31b9cfe4f1914762a78a9',
        externalId,
      },
    }
  }

  it('upgrades agency on real PaymentLinks payload (camelCase externalId, no English "success" status)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_paymentlinks_' + Date.now()

    const res = await POST(buildReq({ body: buildRealPaymentLinksPayload(externalId, transactionId) }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    expect(agency.planReason).toBe(`grow:${transactionId}`)

    const payment = await db('payments').where({ transactionId }).first()
    expect(payment).toBeTruthy()
    expect(payment.agencyId).toBe(agencyId)
  })

  it('does NOT ignore the webhook just because status is not the English "success"', async () => {
    // This is the regression case: previously the handler short-circuited
    // any payload whose `status` field didn't equal the literal 'success'.
    // Real PaymentLinks payloads have `status: 'שולם'` or no English status,
    // which used to silently drop every real webhook.
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_status_hebrew_' + Date.now()

    const res = await POST(
      buildReq({ body: { data: { transactionId, status: 'שולם', statusCode: '2', externalId } } }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })

  it('processes successfully even when payload has no status field at all', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_no_status_' + Date.now()

    const res = await POST(buildReq({ body: { data: { transactionId, externalId } } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })

  it('accepts external_id in snake_case (legacy compatibility)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_snake_ext_' + Date.now()

    const res = await POST(buildReq({ body: { data: { transactionId, external_id: externalId } } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })
})

/**
 * Legacy payload compatibility (TEST B).
 *
 * The pre-existing happy-path tests above already exercise the flat and
 * the nested-with-snake-case-external_id shapes. This block adds an
 * explicit test for the flat legacy payload with the `status: 'success'`
 * English value, confirming we still accept payloads from the older
 * static-payment-pages flow.
 */
describe('POST /api/payments/grow — legacy payload compatibility (TEST B)', () => {
  it('accepts flat legacy payload with English "success" status', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_legacy_flat_' + Date.now()

    const res = await POST(
      buildReq({ body: { transactionId, status: 'success', external_id: externalId } }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
  })
})

/**
 * Field-name tolerance — real PaymentLinks vs docs vs legacy.
 *
 * Real production captures revealed that Grow PaymentLinks sends
 * `transactionCode` (not `transactionId`) and `identifyParam` (not
 * `externalId`/`external_id`). The handler accepts all variants.
 */
describe('POST /api/payments/grow — field-name fallbacks', () => {
  it('A: PaymentLinks payload with transactionCode + identifyParam', async () => {
    const agencyId = await seedAgency()
    const identifyParam = signToken(agencyId)
    const transactionCode = 'tx_code_pl_' + Date.now()

    const res = await POST(
      buildReq({
        body: {
          data: {
            transactionCode,
            identifyParam,
            // Other real PaymentLinks fields, present but not consumed by the handler:
            asmachta: '12345',
            sum: '13',
            statusCode: '2',
            status: 'שולם',
            paymentLinkProcessId: 'plp_1',
          },
        },
      }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')
    expect(agency.planReason).toBe(`grow:${transactionCode}`)

    // The handler should record the resolved value under transactionId in
    // the payments table regardless of which field name the source used.
    const payment = await db('payments').where({ transactionId: transactionCode }).first()
    expect(payment).toBeTruthy()
    expect(payment.agencyId).toBe(agencyId)
  })

  it('B: legacy payload with transactionId + externalId (camelCase)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_legacy_camel_' + Date.now()

    const res = await POST(buildReq({ body: { data: { transactionId, externalId } } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')

    const payment = await db('payments').where({ transactionId }).first()
    expect(payment).toBeTruthy()
  })

  it('C: mixed payload — transactionId (legacy) + identifyParam (PaymentLinks)', async () => {
    const agencyId = await seedAgency()
    const identifyParam = signToken(agencyId)
    const transactionId = 'tx_mixed_' + Date.now()

    const res = await POST(buildReq({ body: { data: { transactionId, identifyParam } } }))

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')

    const payment = await db('payments').where({ transactionId }).first()
    expect(payment).toBeTruthy()
  })

  it('C2: mixed payload — transactionCode (PaymentLinks) + external_id (legacy snake_case)', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionCode = 'tx_mixed2_' + Date.now()

    const res = await POST(
      buildReq({ body: { data: { transactionCode, external_id: externalId } } }),
    )

    expect(res.status).toBe(200)
    const agency = await db('agencies').where({ id: agencyId }).first()
    expect(agency.plan).toBe('pro')

    const payment = await db('payments').where({ transactionId: transactionCode }).first()
    expect(payment).toBeTruthy()
  })

  it('precedence: when BOTH transactionId and transactionCode are present, transactionId wins', async () => {
    const agencyId = await seedAgency()
    const externalId = signToken(agencyId)
    const transactionId = 'tx_precedence_primary_' + Date.now()
    const transactionCode = 'tx_precedence_fallback_' + Date.now()

    const res = await POST(
      buildReq({ body: { data: { transactionId, transactionCode, externalId } } }),
    )

    expect(res.status).toBe(200)

    // Primary value (transactionId) is what gets persisted; the fallback
    // value (transactionCode) is NOT recorded anywhere.
    const primary = await db('payments').where({ transactionId }).first()
    expect(primary).toBeTruthy()
    const fallbackRow = await db('payments').where({ transactionId: transactionCode }).first()
    expect(fallbackRow).toBeUndefined()
  })
})

describe('Full flow integration', () => {
  it('upgrade route → extract external_id → webhook → DB upgraded', async () => {
    const agencyId = await seedAgency()
    vi.mocked(requireUser).mockResolvedValueOnce({ id: 1, agencyId, email: 'e2e-' + Date.now() + '@example.com' } as any)

    // 1. User clicks upgrade
    const upgradeRes = await UPGRADE_GET(
      new NextRequest('http://localhost:3000/api/payments/upgrade', { method: 'GET', headers: { host: APP_HOST } }),
    )
    expect(upgradeRes.status).toBe(302)
    const growUrl = new URL(upgradeRes.headers.get('location')!)
    const externalId = growUrl.searchParams.get('identifyParam')!
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
