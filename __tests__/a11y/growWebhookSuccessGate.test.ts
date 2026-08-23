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
import fs from 'node:fs'
import { classifyPaymentOutcome, classifyPaymentMode, classifyPaymentSequence } from '@/lib/payments/paymentOutcome'

const read = (p: string) => fs.readFileSync(p, 'utf8')

const SECRET = 'test-only-webhook-secret-not-a-real-value'
const AGENCY_ID = 4242

const H = vi.hoisted(() => ({
  performAgencyUpgrade: vi.fn(),
  verifyToken: vi.fn(),
  paymentsInsert: vi.fn(),
  pendingFirst: vi.fn(),
  pendingUpdate: vi.fn(),
  pendingRows: vi.fn(() => []),
  userRows: vi.fn(() => []),
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

/**
 * Minimal knex double: only the shapes the route actually uses.
 *
 * Owner resolution needs two more than before — the pending⋈agencies select for
 * phone candidates, and the users lookup. `H.pendingRows` and `H.userRows` feed
 * those; a chain that is awaited without `.first()` resolves to the array.
 */
vi.mock('@/config/db', () => {
  const table = (name: string) => {
    const chain: any = {
      insert: (...a: unknown[]) => H.paymentsInsert(name, ...a),
      whereRaw: () => chain,
      where: () => chain,
      whereIn: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      select: () => chain,
      first: () => H.pendingFirst(name),
      update: (...a: unknown[]) => H.pendingUpdate(name, ...a),
      then: (res: any, rej: any) =>
        Promise.resolve(name === 'users' ? H.userRows() : H.pendingRows()).then(res, rej),
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
  H.pendingRows.mockReturnValue([])
  H.userRows.mockReturnValue([])
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

  it('reads payment mode from the documented paymentType enum', () => {
    expect(classifyPaymentMode({ paymentType: 'הוראת קבע' })).toBe('recurring')
    expect(classifyPaymentMode({ paymentType: 'רגיל' })).toBe('one_time')
    expect(classifyPaymentMode({ paymentType: 'תשלומים' })).toBe('one_time')
  })

  /**
   * The conflation that caused the outage. Grow documents directDebitId as
   * "קוד הוראת קבע ולא קוד עסקה" — the MANDATE code, not a transaction code —
   * so a charge that opens a mandate carries it exactly as a later charge does.
   */
  it('does not read payment mode from a mandate id', () => {
    expect(classifyPaymentMode({ directDebitId: '55' })).toBe('one_time')
    expect(classifyPaymentMode({ regular_payment_id: '9' })).toBe('one_time')
  })
})

/* ------------------------------------------------------------------------- *
 * THE REAL PRODUCTION PAYLOAD — AN INITIAL RECURRING CHARGE.
 *
 * Transaction GvNe/kVpyRfBqOuIks4kXA==, agency 103, a genuine ₪1 charge. Grow's
 * merchant record identifies it as "הו"ק / 1", source עמוד קבוע: the FIRST
 * charge of a monthly standing order, not a one-time payment.
 *
 * The webhook authenticated and was then refused. The payload carries no status
 * field (correctly `unverifiable`), and the presence of `directDebitId` was
 * misread as "this is a recurring RUN" — so `unverifiable && recurring` denied a
 * payment that had already been taken, and with it every subscription
 * activation the product has.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. The 26 KEYS are copied verbatim from the
 * production log. The VALUES were never captured — the handler logged keys only
 * — so every value below is SYNTHETIC. Where Grow's documentation establishes
 * an enum the documented value is used (`paymentType`, `transactionType`);
 * everything else is a plausible placeholder and must not be read as observed
 * fact. An earlier revision of this file invented `transactionType: 'signle'`
 * and `paymentType: 'authorize'` and presented them as real; that is how a
 * wrong diagnosis got written down twice.
 * ------------------------------------------------------------------------- */

/** SYNTHETIC values, real key set. `paymentType` and `directDebitId` overridable. */
function growPayload(
  over: { paymentType?: unknown; directDebitId?: unknown } = {},
): Record<string, unknown> {
  return {
    webhookKey: SECRET,
    identifyParam: '',
    transactionCode: 'GvNe/kVpyRfBqOuIks4kXA==',
    transactionType: 'אשראי', // documented example value: credit
    paymentSum: 1,
    paymentsNum: 0,
    allPaymentNum: 1,
    firstPaymentSum: 0,
    periodicalPaymentSum: 0,
    paymentType: 'paymentType' in over ? over.paymentType : 'הוראת קבע', // documented enum
    paymentDate: '22/08/26',
    asmachta: 'SYNTHETIC-REFERENCE',
    paymentDesc: 'SocialCRM Pro',
    fullName: 'Synthetic Payer',
    payerPhone: '0500000000',
    payerEmail: 'alamayo274@gmail.com',
    cardSuffix: '0000',
    cardBrand: 'Visa',
    cardType: 'Local',
    cardBin: '000000',
    paymentSource: 'PaymentLink',
    ip: '0.0.0.0',
    invoiceURL: '',
    invoiceName: '',
    invoiceLicenseNumber: '',
    directDebitId: 'directDebitId' in over ? over.directDebitId : '778899',
    transactionId: 'GvNe/kVpyRfBqOuIks4kXA==',
  }
}

/** The incident payload: initial standing-order charge, mandate id, no status. */
const realInitialRecurringPayload = () => growPayload()

/* ------------------------------------------------------------------------- *
 * MODE AND SEQUENCE — THE FIX FOR THE PRODUCTION OUTAGE.
 *
 * Grow documents `directDebitId` as the standing-order MANDATE code, and the
 * dedicated recurring webhook as "Triggered for recurring payments starting
 * from the second charge". Our route is the transaction webhook, so a
 * standing-order charge arriving here is the one that OPENED the mandate.
 * ------------------------------------------------------------------------- */

describe('mode and sequence classification', () => {
  it('D. the real incident payload is recurring + initial', () => {
    const p = realInitialRecurringPayload()
    expect(classifyPaymentMode(p)).toBe('recurring')
    expect(classifyPaymentSequence(p, 'recurring')).toBe('initial')
    expect(classifyPaymentOutcome({ err: '' }, p)).toBe('unverifiable')
  })

  it('L. a mandate id alone does NOT make a charge subsequent', () => {
    for (const id of ['778899', 778899, 'abc-123']) {
      const p = growPayload({ paymentType: 'רגיל', directDebitId: id })
      expect(classifyPaymentMode(p), String(id)).toBe('one_time')
      expect(classifyPaymentSequence(p, 'one_time'), String(id)).toBe('initial')
    }
  })

  it('G. a documented one-time paymentType is one_time', () => {
    const p = growPayload({ paymentType: 'רגיל', directDebitId: '' })
    expect(classifyPaymentMode(p)).toBe('one_time')
    expect(classifyPaymentSequence(p, 'one_time')).toBe('initial')
  })

  /** Fail closed: a mandate id with no recognisable paymentType is ambiguous. */
  it('F. an unrecognised paymentType alongside a mandate id is unknown', () => {
    for (const t of [undefined, '', 'something-else']) {
      const p = growPayload({ paymentType: t, directDebitId: '778899' })
      expect(classifyPaymentSequence(p, classifyPaymentMode(p)), String(t)).toBe('unknown')
    }
  })

  it('a payload with neither paymentType nor mandate id stays one_time + initial', () => {
    const p = growPayload({ paymentType: undefined, directDebitId: '' })
    expect(classifyPaymentMode(p)).toBe('one_time')
    expect(classifyPaymentSequence(p, 'one_time')).toBe('initial')
  })

  it('the classifier reads paymentType, and no longer keys mode on a mandate id', () => {
    const src = read('lib/payments/paymentOutcome.ts')
    expect(src).toContain("const GROW_PAYMENT_TYPE_RECURRING = 'הוראת קבע'")
    expect(src).toContain('export function classifyPaymentMode')
    expect(src).toContain('export function classifyPaymentSequence')
    expect(src).not.toContain('export function isRecurringRun')
  })

  it('the false comments from the earlier fix are gone', () => {
    const src = read('lib/payments/paymentOutcome.ts')
    expect(src).not.toContain('was a one-time Payment Link charge')
    expect(src).not.toContain('fills the inapplicable fields with')
    expect(src).not.toContain("refused a real customer's successful one-time payment")
  })

  it('the temporary diagnostic logging was removed from the route', () => {
    const route = read('app/api/payments/grow/route.ts')
    expect(route).not.toContain('DIAGNOSTIC_FIELDS')
    expect(route).not.toContain('classificationFields')
    expect(route).not.toContain('classification fields')
  })
})

describe('the initial subscription charge activates; a later one still fails closed', () => {
  it('D. unverifiable + recurring + initial GRANTS — the outage payload', async () => {
    const res = await POST(req({ err: '', status: '1', data: realInitialRecurringPayload() }))
    expect(res.status).toBe(200)
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('G. unverifiable + one_time still grants, unchanged', async () => {
    const res = await POST(req({ err: '', status: '1', data: growPayload({ paymentType: 'רגיל', directDebitId: '' }) }))
    expect(res.status).toBe(200)
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('F. unverifiable + recurring + unknown REFUSES', async () => {
    const res = await POST(
      req({ err: '', status: '1', data: growPayload({ paymentType: 'something-else', directDebitId: '778899' }) }),
    )
    expect(await res.json()).toMatchObject({ granted: false, reason: 'unverifiable' })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('H. a FAILED recurring charge still refuses', async () => {
    const res = await POST(
      req({ err: '', status: '1', data: { ...realInitialRecurringPayload(), statusCode: '5' } }),
    )
    expect(await res.json()).toMatchObject({ granted: false, reason: 'not_success' })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('C. a pending recurring charge still refuses', async () => {
    const res = await POST(
      req({ err: '', status: '1', data: { ...realInitialRecurringPayload(), status: 'pending' } }),
    )
    expect(await res.json()).toMatchObject({ granted: false, reason: 'pending' })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('A. a confirmed success grants regardless of mode', async () => {
    const res = await POST(
      req({ err: '', status: '1', data: { ...realInitialRecurringPayload(), statusCode: '2', status: 'שולם' } }),
    )
    expect(res.status).toBe(200)
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('K. a refused charge writes nothing at all', async () => {
    await POST(req({ err: '', status: '1', data: { ...realInitialRecurringPayload(), statusCode: '5' } }))
    expect(H.paymentsInsert).not.toHaveBeenCalled()
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
    expect(H.pendingUpdate).not.toHaveBeenCalled()
  })

  it('I. idempotency is unchanged for the initial charge', async () => {
    H.paymentsInsert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await POST(req({ err: '', status: '1', data: realInitialRecurringPayload() }))
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('J. an invalid webhookKey is still 401, before any classification', async () => {
    const data = realInitialRecurringPayload()
    data.webhookKey = 'wrong-secret-value-of-the-same-shape'
    const res = await POST(req({ err: '', status: '1', data }))
    expect(res.status).toBe(401)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
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

/* ------------------------------------------------------------------------- *
 * OWNER RESOLUTION — token, then email, then phone.
 *
 * Grow does not echo `identifyParam` on this link type, so the signed token
 * arrives empty and ownership falls to `payerEmail`, a free-text field the payer
 * types at checkout. Two real charges were taken and refused with 404 because
 * that value did not match the pending row. Phone is a SECOND deterministic
 * signal drawn only from agencies that already have a pending checkout, and it
 * must be unique or it is not used.
 * ------------------------------------------------------------------------- */

const OTHER_AGENCY = 5150

/** Pending rows joined to agencies, as the phone resolver selects them. */
const pendingWithPhones = (rows: Array<{ agencyId: number; agencyPhone: string | null }>) =>
  H.pendingRows.mockReturnValue(rows)

/* ------------------------------------------------------------------------- *
 * THE MANDATE ID.
 *
 * Grow documents `directDebitId` as "קוד הוראת קבע ולא קוד עסקה" — the standing
 * order code, not a transaction code. It arrives on every payload and the
 * handler discarded it, so a live subscription's mandate could not be addressed
 * afterwards. It is now persisted, and ONLY persisted: nothing about payment
 * classification reads it.
 * ------------------------------------------------------------------------- */

/** Every `.update()` the route issued, as [table, patch] pairs. */
const updatesFor = (table: string) =>
  H.pendingUpdate.mock.calls.filter((c: any[]) => c[0] === table).map((c: any[]) => c[1])

describe('the standing-order mandate id is persisted with the subscription', () => {
  it('a successful activation stores directDebitId on the subscription', async () => {
    await POST(req(growBody({ statusCode: '2', externalId: 'tok', directDebitId: '778899' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    expect(updatesFor('subscriptions')).toEqual([{ growDirectDebitId: '778899' }])
  })

  it('a numeric mandate id is stored as text, unchanged', async () => {
    await POST(req(growBody({ statusCode: '2', externalId: 'tok', directDebitId: 778899 })))
    expect(updatesFor('subscriptions')).toEqual([{ growDirectDebitId: '778899' }])
  })

  it.each([undefined, null, '', '0', 0, 'null', 'false', '-1'])(
    'an absent or placeholder mandate id (%p) writes nothing, leaving the column null',
    async (v) => {
      await POST(req(growBody({ statusCode: '2', externalId: 'tok', directDebitId: v })))
      expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1) // activation still succeeds
      expect(updatesFor('subscriptions')).toEqual([]) // …but no mandate is invented
    },
  )

  it('the write happens inside the activation transaction', () => {
    const src = read('app/api/payments/grow/route.ts')
    const txAt = src.indexOf('await db.transaction(async (trx) => {')
    const closeAt = src.indexOf('  } catch (err: any) {', txAt)
    const body = src.slice(txAt, closeAt)
    expect(body).toContain("trx('subscriptions').where({ agencyId }).update({ growDirectDebitId: mandateId })")
    // and after the upgrade, so the row it updates exists
    expect(body.indexOf('performAgencyUpgrade')).toBeLessThan(body.indexOf('growDirectDebitId'))
  })

  it('a duplicate transaction stays idempotent and stores no mandate', async () => {
    H.paymentsInsert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await POST(req(growBody({ statusCode: '2', externalId: 'tok', directDebitId: '778899' })))
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
    expect(updatesFor('subscriptions')).toEqual([])
  })

  it('a refused payment stores no mandate', async () => {
    await POST(req(growBody({ statusCode: '5', externalId: 'tok', directDebitId: '778899' })))
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
    expect(updatesFor('subscriptions')).toEqual([])
  })

  /** The regression that caused the outage must not creep back in. */
  it('the mandate id does NOT influence payment classification', () => {
    for (const id of ['778899', 778899, '', 0, null]) {
      expect(classifyPaymentMode({ directDebitId: id, paymentType: 'רגיל' })).toBe('one_time')
      expect(classifyPaymentMode({ directDebitId: id, paymentType: 'הוראת קבע' })).toBe('recurring')
    }
    const outcome = read('lib/payments/paymentOutcome.ts')
    expect(outcome).not.toContain('growDirectDebitId')
  })

  it('performAgencyUpgrade was not given a new responsibility', () => {
    const src = read('lib/quota/performUpgrade.ts')
    expect(src).not.toContain('growDirectDebitId')
    expect(src).not.toContain('directDebitId')
  })

  it('existing activation behaviour is unchanged when no mandate id is present', async () => {
    await POST(req(growBody({ statusCode: '2', externalId: 'tok' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    const [agency, reason] = H.performAgencyUpgrade.mock.calls[0]
    expect(agency).toBe(AGENCY_ID)
    expect(String(reason)).toMatch(/^grow:tx_/)
    expect(updatesFor('pending_upgrades').length).toBe(1) // still marked completed
  })

  it('the column is nullable and indexed, so old rows keep working', () => {
    const mig = read('migrations/20260823090000_subscriptions_grow_direct_debit_id.cjs')
    const addCol = mig.split('\n').find((l) => l.includes('ADD COLUMN IF NOT EXISTS "growDirectDebitId"'))!
    expect(addCol).toContain('"growDirectDebitId" text')
    // nullable, no default: the column itself carries no NOT NULL / DEFAULT.
    expect(addCol).not.toMatch(/NOT NULL "|text NOT NULL|DEFAULT/)
    expect(mig).toContain('CREATE INDEX IF NOT EXISTS subscriptions_grow_direct_debit_id_idx')
  })
})

describe('owner resolution: token, then email, then phone', () => {
  it('a valid token wins, and neither email nor phone is consulted', async () => {
    H.verifyToken.mockReturnValue({ agencyId: AGENCY_ID, issuedAt: Date.now() })
    pendingWithPhones([{ agencyId: OTHER_AGENCY, agencyPhone: '053-531-7356' }])
    await POST(req(growBody({ statusCode: '2', externalId: 'tok', payerPhone: '0535317356' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    expect(H.performAgencyUpgrade.mock.calls[0][0]).toBe(AGENCY_ID)
  })

  it('an email match resolves the agency (primary fallback, unchanged)', async () => {
    H.pendingFirst.mockResolvedValue({ agencyId: AGENCY_ID })
    await POST(req(growBody({ statusCode: '2', payerEmail: 'a@b.test' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    expect(H.performAgencyUpgrade.mock.calls[0][0]).toBe(AGENCY_ID)
  })

  it('email miss + a UNIQUE phone match resolves the agency', async () => {
    H.pendingFirst.mockResolvedValue(undefined) // no email match
    pendingWithPhones([{ agencyId: AGENCY_ID, agencyPhone: '053-531-7356' }])
    await POST(req(growBody({ statusCode: '2', payerEmail: 'nobody@b.test', payerPhone: '0535317356' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
    expect(H.performAgencyUpgrade.mock.calls[0][0]).toBe(AGENCY_ID)
  })

  it('normalises the phone: 972-prefixed and 0-prefixed compare equal', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([{ agencyId: AGENCY_ID, agencyPhone: '0535317356' }])
    await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '972535317356' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('a user phone resolves when the agency itself has none', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([{ agencyId: AGENCY_ID, agencyPhone: null }])
    H.userRows.mockReturnValue([{ agencyId: AGENCY_ID, phone: '053-531-7356' }])
    await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '0535317356' })))
    expect(H.performAgencyUpgrade).toHaveBeenCalledTimes(1)
  })

  it('email miss + phone miss REFUSES with 404 and writes nothing', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([{ agencyId: OTHER_AGENCY, agencyPhone: '050-000-0000' }])
    const res = await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '0535317356' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
    expect(H.paymentsInsert).not.toHaveBeenCalled()
    expect(H.pendingUpdate).not.toHaveBeenCalled()
  })

  it('MULTIPLE phone candidates refuse — ambiguity is never resolved', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([
      { agencyId: AGENCY_ID, agencyPhone: '0535317356' },
      { agencyId: OTHER_AGENCY, agencyPhone: '053-531-7356' },
    ])
    const res = await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '0535317356' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('email and phone pointing at DIFFERENT agencies refuses', async () => {
    H.pendingFirst.mockResolvedValue({ agencyId: AGENCY_ID })
    pendingWithPhones([{ agencyId: OTHER_AGENCY, agencyPhone: '0535317356' }])
    const res = await POST(req(growBody({ statusCode: '2', payerEmail: 'a@b.test', payerPhone: '0535317356' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('token, email and phone all missing refuses', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([])
    const res = await POST(req(growBody({ statusCode: '2' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('a phone too short to be a real number is not a signal', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([{ agencyId: AGENCY_ID, agencyPhone: '12345' }])
    const res = await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '12345' })))
    expect(res.status).toBe(404)
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })

  it('candidates are drawn only from PENDING rows — never the global agency table', () => {
    const src = read('app/api/payments/grow/route.ts')
    expect(src).toContain("where('pending_upgrades.status', 'pending')")
    expect(src).not.toMatch(/db\('agencies'\)\s*\n?\s*\.select/)
  })

  it('the removed sole-pending-agency heuristic did not come back', () => {
    const src = read('app/api/payments/grow/route.ts')
    expect(src).toContain('ids.length === 1 ? ids[0] : null')
    expect(src).not.toContain('the only pending agency')
  })

  it('idempotency is unchanged when ownership resolves by phone', async () => {
    H.pendingFirst.mockResolvedValue(undefined)
    pendingWithPhones([{ agencyId: AGENCY_ID, agencyPhone: '0535317356' }])
    H.paymentsInsert.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    const res = await POST(req(growBody({ statusCode: '2', payerEmail: 'x@y.test', payerPhone: '0535317356' })))
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(H.performAgencyUpgrade).not.toHaveBeenCalled()
  })
})

describe('the ownership failure is diagnosable without leaking PII', () => {
  const SRC = read('app/api/payments/grow/route.ts')

  it('masks the payer email: first 3 characters and the domain only', () => {
    // the helper now lives in the shared Grow webhook module
    const shared = read('lib/payments/growWebhook.ts')
    expect(shared).toContain('export function maskEmail')
    expect(shared).toContain("return `${e.slice(0, 3)}***@${e.slice(at + 1)}`")
    expect(SRC).toContain('payerEmail: maskEmail(')
  })

  it('never logs the full address, the phone, the name, the card or the secret', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const logged = [...code.matchAll(/console\.(log|warn|error)\(([\s\S]*?)\)\n/g)].map((m) => m[2]).join(' ')
    for (const bad of ['payerPhone:', 'fullName', 'cardSuffix', 'cardBin']) {
      expect(logged, bad).not.toContain(bad)
    }
    // the raw email must never be passed to a logger unmasked
    expect(logged).not.toMatch(/payerEmail: payload/)
    /**
     * The secret is only ever logged as a PRESENCE flag, never as a value:
     * `webhookKey ? 'present' : 'absent'` is fine, passing the variable is not.
     */
    expect(logged).toContain("webhookKey ? 'present' : 'absent'")
    expect(logged).not.toMatch(/webhookKey: webhookKey\s*[,}]/)
  })

  it('reports how many phone candidates were seen, so ambiguity is visible', () => {
    expect(SRC).toContain('phoneCandidates:')
    expect(SRC).toContain('conflict:')
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
