// Billing Phase 1 — proof of payment before entitlement.
//
// WHY THIS FILE LIVES HERE. The existing billing tests
// (`__tests__/payments-webhook-route.test.ts`) are DB-backed and currently
// cannot run at all: the test database fails to migrate with
// `relation "clients" does not exist`. Rather than add more tests that never
// execute, these mock the data layer and run in the no-DB suite, where they
// actually gate merges. They assert the one thing that matters most —
// `performAgencyUpgrade` is NEVER reached for a payment that is not confirmed.
//
// No secrets are printed: the fake webhook secret is a local constant.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyPaymentOutcome, isRecurringRun } from '@/lib/payments/paymentOutcome'

const SECRET = 'test-only-webhook-secret-not-a-real-value'
const AGENCY_ID = 4242

const H = vi.hoisted(() => ({
  performAgencyUpgrade: vi.fn(),
  verifyToken: vi.fn(),
  paymentsInsert: vi.fn(),
  pendingFirst: vi.fn(),
  pendingUpdate: vi.fn(),
}))

vi.mock('@/lib/quota/performUpgrade', () => ({ performAgencyUpgrade: H.performAgencyUpgrade }))
vi.mock('@/lib/payments/token', () => ({ verifyToken: H.verifyToken }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(async () => {}) }))
vi.mock('@/lib/emailAutomations/live', () => ({ dispatchLifecycleEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/emailAutomations/recipients', () => ({ agencyOwner: vi.fn(async () => null) }))
vi.mock('@/db/trial', () => ({ getAgencyTrial: vi.fn(async () => null) }))
vi.mock('@/lib/trial', () => ({ getTrialState: vi.fn(() => ({ status: 'NEVER_STARTED' })) }))
vi.mock('@/lib/payments/resolvePeriod', () => ({
  resolveBillingPeriod: vi.fn(async () => ({ period: 'monthly', resolvedBy: 'fallback', candidates: {} })),
  logPeriodResolution: vi.fn(),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<any>()), after: (fn: any) => fn() }))

// Minimal knex double: only the shapes the route actually uses.
vi.mock('@/config/db', () => {
  const table = (name: string) => {
    const chain: any = {
      insert: (...a: unknown[]) => H.paymentsInsert(name, ...a),
      whereRaw: () => chain,
      where: () => chain,
      orderBy: () => chain,
      first: () => H.pendingFirst(name),
      update: (...a: unknown[]) => H.pendingUpdate(name, ...a),
    }
    return chain
  }
  const db: any = (name: string) => table(name)
  db.transaction = async (cb: any) => cb(db)
  return { db }
})

let POST: (req: any) => Promise<Response>

beforeEach(async () => {
  vi.stubEnv('APP_ENV', 'production')
  vi.stubEnv('GROW_MODE', 'production')
  vi.stubEnv('APP_HOST', 'example.test')
  vi.stubEnv('GROW_WEBHOOK_SECRET', SECRET)
  H.performAgencyUpgrade.mockResolvedValue({ success: true })
  H.verifyToken.mockReturnValue({ agencyId: AGENCY_ID, issuedAt: Date.now() })
  H.paymentsInsert.mockResolvedValue(undefined)
  H.pendingFirst.mockResolvedValue({ agencyId: AGENCY_ID })
  H.pendingUpdate.mockResolvedValue(1)
  ;({ POST } = await import('@/app/api/payments/grow/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.resetModules()
})

const req = (body: unknown) =>
  ({
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? 'example.test' : null) },
    text: async () => JSON.stringify(body),
  }) as any

/** The docs-verbatim PaymentLinks envelope, with an overridable data block. */
const growBody = (data: Record<string, unknown>, err = '') => ({
  err,
  status: '1',
  data: { webhookKey: SECRET, transactionId: 'tx_' + Math.random().toString(36).slice(2), ...data },
})

describe('classifier — evidence-based, never invents Grow codes', () => {
  it("treats the documented paid code '2' (שולם) as success", () => {
    expect(classifyPaymentOutcome({ err: '' }, { statusCode: '2', status: 'שולם' })).toBe('success')
  })

  it('treats any other statusCode as NOT success', () => {
    for (const code of ['0', '1', '3', '99']) {
      expect(classifyPaymentOutcome({ err: '' }, { statusCode: code })).toBe('not_success')
    }
  })

  it('treats an envelope-level error as NOT success', () => {
    expect(classifyPaymentOutcome({ err: 'card declined' }, { statusCode: '2' })).toBe('not_success')
  })

  it('recognises failure words when no statusCode is present', () => {
    for (const w of ['failed', 'declined', 'rejected', 'נדחה']) {
      expect(classifyPaymentOutcome({}, { status: w })).toBe('not_success')
    }
  })

  it('reports absent status as unverifiable, not success', () => {
    expect(classifyPaymentOutcome({}, { transactionId: 'x' })).toBe('unverifiable')
  })

  /**
   * The ordering defect. Matching is by substring and success used to be tested
   * first, so every negated success word read as a paid charge.
   */
  it.each(['לא שולם', 'לא אושר', 'unpaid', 'not paid', 'not approved', 'not successful'])(
    'reads %s as NOT paid, even though it contains a success word',
    (status) => {
      expect(classifyPaymentOutcome({}, { status })).toBe('not_success')
    },
  )

  it('still reads the bare success words as paid', () => {
    for (const status of ['שולם', 'success', 'approved', 'paid']) {
      expect(classifyPaymentOutcome({}, { status }), status).toBe('success')
    }
  })

  /** A word merely CONTAINING a negation fragment must not deny a real payment. */
  it('does not mistake an ordinary word for a negation', () => {
    // 'account' contains 'un' — a prefix heuristic would have refused this.
    expect(classifyPaymentOutcome({}, { status: 'account paid' })).toBe('success')
  })

  it.each(['pending', 'ממתין', 'awaiting payment', 'in process', 'processing'])(
    'reports %s as pending, never as success or unverifiable',
    (status) => {
      expect(classifyPaymentOutcome({}, { status })).toBe('pending')
    },
  )

  it('detects a standing-order run by its recurring identifier', () => {
    expect(isRecurringRun({ directDebitId: '55' })).toBe(true)
    expect(isRecurringRun({ regular_payment_id: '9' })).toBe(true)
    expect(isRecurringRun({ transactionId: 'x' })).toBe(false)
  })
})

describe('webhook — entitlement requires proof of payment', () => {
  it('grants on a confirmed successful payment', async () => {
    const res = await POST(req(growBody({ statusCode: '2', status: 'שולם', externalId: 'tok' })))
    expect(res.status).toBe(200)
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('does NOT grant on a failed payment', async () => {
    const res = await POST(req(growBody({ statusCode: '4', status: 'נדחה', externalId: 'tok' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ granted: false })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('does NOT grant on a rejected payment', async () => {
    await POST(req(growBody({ status: 'rejected', externalId: 'tok' })))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it.each(['declined', 'נדחה', 'card declined by issuer'])(
    'does NOT grant on a declined payment (%s)',
    async (status) => {
      const res = await POST(req(growBody({ status, externalId: 'tok' })))
      expect(await res.json()).toMatchObject({ granted: false, reason: 'not_success' })
      expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
    },
  )

  /**
   * A pending charge used to fall through to `unverifiable`, which on the
   * one-time path means GRANT. An unfinished payment bought a billing period.
   */
  it.each(['pending', 'ממתין', 'processing'])('does NOT grant on a pending payment (%s)', async (status) => {
    const res = await POST(req(growBody({ status, externalId: 'tok' })))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'pending' })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /** Refusing a pending charge must not consume its transaction id. */
  it('records no payment row when it refuses, so a later success still grants', async () => {
    await POST(req(growBody({ transactionId: 'tx_same', status: 'pending', externalId: 'tok' })))
    expect(H.paymentsInsert).not.toHaveBeenCalled()
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()

    // The same charge settles and Grow re-delivers it as confirmed.
    await POST(req(growBody({ transactionId: 'tx_same', statusCode: '2', externalId: 'tok' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  /** The negated-success hole, proven at the boundary that grants Pro. */
  it.each(['לא שולם', 'unpaid', 'not approved'])('does NOT grant on %s', async (status) => {
    await POST(req(growBody({ status, externalId: 'tok' })))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('does NOT grant when the envelope reports an error', async () => {
    await POST(req(growBody({ statusCode: '2', externalId: 'tok' }, 'some failure')))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /** The hole this phase exists to close, on the surface about to be enabled. */
  it('does NOT grant on a recurring run with an unverifiable status', async () => {
    const res = await POST(req(growBody({ directDebitId: '778899', externalId: 'tok' })))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'unverifiable' })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('does NOT grant on a FAILED recurring run', async () => {
    await POST(req(growBody({ directDebitId: '778899', statusCode: '5', externalId: 'tok' })))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /**
   * Regression guard for the documented outage: real one-time PaymentLinks
   * webhooks carry no usable status, and must keep working.
   */
  it('still grants a one-time payment that carries no status field', async () => {
    await POST(req(growBody({ externalId: 'tok' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid webhook secret with 401 and never grants', async () => {
    const body = growBody({ statusCode: '2', externalId: 'tok' })
    body.data.webhookKey = 'wrong-secret-value-of-the-same-shape'
    const res = await POST(req(body))
    expect(res.status).toBe(401)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('is idempotent: a duplicate transaction extends nothing further', async () => {
    H.paymentsInsert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await POST(req(growBody({ statusCode: '2', externalId: 'tok' })))
    expect(await res.json()).toMatchObject({ duplicate: true })
    // The UNIQUE violation aborts the transaction before the upgrade runs, so
    // the subscription period is never extended a second time for one charge.
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /**
   * The same delivery, twice. The first grants; the second hits the UNIQUE
   * constraint on payments.transactionId and changes nothing.
   */
  it('a redelivered successful webhook grants exactly once', async () => {
    const body = growBody({ transactionId: 'tx_dup', statusCode: '2', externalId: 'tok' })
    await POST(req(body))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)

    H.paymentsInsert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await POST(req(body))
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  /**
   * The blunt statement of this phase's goal: a fresh transaction id is NOT
   * evidence of payment. Every one of these carries an id never seen before.
   */
  it.each([
    ['a failed charge', { statusCode: '4' }],
    ['a declined charge', { status: 'declined' }],
    ['a pending charge', { status: 'pending' }],
    ['an unpaid charge', { status: 'לא שולם' }],
    ['an errored envelope', { statusCode: '2' }],
  ])('never grants Pro for %s merely because the transactionId is new', async (label, data) => {
    const err = label === 'an errored envelope' ? 'gateway failure' : ''
    await POST(req(growBody({ ...data, externalId: 'tok' }, err)))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /** Entitlement is granted to the agency the signed token names, and no other. */
  it('activates only the agency resolved from the signed token', async () => {
    await POST(req(growBody({ statusCode: '2', externalId: 'tok' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    const [resolvedAgencyId, reason] = H.performAgencyUpgrade.mock.calls[0]
    expect(resolvedAgencyId).toBe(AGENCY_ID)
    // The reason string carries the transaction, which is what makes the grant
    // auditable back to a specific payment.
    expect(String(reason)).toMatch(/^grow:tx_/)
  })

  it('refuses when no owner can be resolved at all, rather than guessing one', async () => {
    H.verifyToken.mockImplementation(() => {
      throw new Error('Token expired')
    })
    H.pendingFirst.mockResolvedValue(undefined)
    const res = await POST(req(growBody({ statusCode: '2', externalId: 'stale' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('refuses a payload with no transactionId before any entitlement work', async () => {
    const body = growBody({ statusCode: '2', externalId: 'tok' })
    delete (body.data as Record<string, unknown>).transactionId
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('rejects a missing webhook secret with 401 and never grants', async () => {
    const body = growBody({ statusCode: '2', externalId: 'tok' })
    delete (body.data as Record<string, unknown>).webhookKey
    const res = await POST(req(body))
    expect(res.status).toBe(401)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })
})

describe('expired identity token no longer blocks the payer-email resolver', () => {
  it('falls through to the email resolver and still grants', async () => {
    H.verifyToken.mockImplementation(() => {
      throw new Error('Token expired')
    })
    await POST(req(growBody({ statusCode: '2', externalId: 'stale', payerEmail: 'a@b.test' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('refuses when the token is expired AND no owner can be matched', async () => {
    H.verifyToken.mockImplementation(() => {
      throw new Error('Token expired')
    })
    H.pendingFirst.mockResolvedValue(undefined)
    const res = await POST(req(growBody({ statusCode: '2', externalId: 'stale', payerEmail: 'a@b.test' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  /** A forged signature must still be refused outright — expiry is not forgery. */
  it('still rejects a forged token with 400 rather than falling through', async () => {
    H.verifyToken.mockImplementation(() => {
      throw new Error('Invalid token signature')
    })
    const res = await POST(req(growBody({ statusCode: '2', externalId: 'forged', payerEmail: 'a@b.test' })))
    expect(res.status).toBe(400)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })
})
