// Grow webhook option 6 — "Recurring payment" (second charge onward).
//
// This endpoint is the one place in the system that extends paid access on a
// charge nobody clicked. Two things must hold and are asserted from every
// angle here: the MANDATE never becomes the idempotency key (that would make
// renewal #3 look like a duplicate of #2 and silently stop extending access),
// and a charge whose subscription is not uniquely identified grants nothing.
//
// No secrets are printed: the fake webhook secret is a local constant.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const read = (p: string) => fs.readFileSync(p, 'utf8')

/** Comments describe what the route must NOT do; assertions must read CODE. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const ROUTE = 'app/api/payments/grow/recurring/route.ts'
const SECRET = 'test-only-webhook-secret-not-a-real-value'
const AGENCY_ID = 4242
const MANDATE = 'mandate-778899'
const CHARGE = 'charge-abc-002'

const H = vi.hoisted(() => ({
  subRows: vi.fn(() => [] as Array<{ agencyId: number }>),
  insert: vi.fn(async (..._a: unknown[]) => {}),
  upgrade: vi.fn(async (..._a: unknown[]) => ({ success: true }) as any),
  track: vi.fn(async (..._a: unknown[]) => {}),
  resolution: vi.fn(() => ({
    period: 'monthly',
    resolvedBy: 'existing_subscription',
    candidates: {
      payment_link_id: null,
      amount: null,
      pending_upgrade: null,
      existing_subscription: 'monthly',
    },
  })),
  order: [] as string[],
}))

vi.mock('@/config/db', () => {
  const table = (name: string) => {
    const chain: any = {
      where: () => chain,
      whereRaw: () => chain,
      whereIn: () => chain,
      orderBy: () => chain,
      select: () => chain,
      first: async () => null,
      update: (...a: unknown[]) => {
        H.order.push(`update:${name}`)
        return Promise.resolve(1)
      },
      insert: async (...a: unknown[]) => {
        H.order.push(`insert:${name}`)
        return H.insert(name, ...a)
      },
      then: (res: any, rej: any) =>
        Promise.resolve(name === 'subscriptions' ? H.subRows() : []).then(res, rej),
    }
    return chain
  }
  const db: any = (name: string) => table(name)
  db.transaction = async (cb: any) => {
    H.order.push('tx:begin')
    const r = await cb(db)
    H.order.push('tx:commit')
    return r
  }
  db.raw = async () => ({ rows: [] })
  return { db }
})

vi.mock('@/lib/quota/performUpgrade', () => ({
  performAgencyUpgrade: (...a: unknown[]) => {
    H.order.push('upgrade')
    return H.upgrade(...a)
  },
}))

vi.mock('@/lib/analytics/track', () => ({ track: (...a: unknown[]) => H.track(...a) }))

vi.mock('@/lib/payments/resolvePeriod', () => ({
  resolveBillingPeriod: async () => H.resolution(),
  logPeriodResolution: () => {},
}))

let POST: (req: any) => Promise<Response>

beforeEach(async () => {
  vi.stubEnv('APP_ENV', 'production')
  vi.stubEnv('GROW_MODE', 'production')
  vi.stubEnv('APP_HOST', 'example.test')
  vi.stubEnv('GROW_WEBHOOK_SECRET', SECRET)
  H.order.length = 0
  H.subRows.mockReturnValue([{ agencyId: AGENCY_ID }])
  H.insert.mockImplementation(async () => {})
  H.upgrade.mockImplementation(async () => ({ success: true }) as any)
  ;({ POST } = await import('@/app/api/payments/grow/recurring/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.resetModules()
})

const req = (body: unknown, host = 'example.test') =>
  ({
    headers: { get: (k: string) => (k.toLowerCase() === 'host' ? host : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as any

/** The documented option 6 payload. Values synthetic; the KEYS are Grow's. */
const renewalBody = (over: Record<string, unknown> = {}) => ({
  webhookKey: SECRET,
  transactionCode: CHARGE,
  transactionType: 'אשראי',
  paymentSum: 89,
  paymentsNum: 1,
  allPaymentNum: 1,
  firstPaymentSum: 0,
  periodicalPaymentSum: 89,
  paymentType: 'הוראת קבע',
  paymentDate: '23/08/2026',
  asmachta: '12345678',
  paymentDesc: 'SocialCRM Pro',
  fullName: 'Synthetic Payer',
  payerPhone: '0500000000',
  payerEmail: 'payer@example.test',
  cardSuffix: '0000',
  cardBrand: 'Visa',
  cardType: 'רגיל',
  paymentSource: 'הוראת קבע',
  directDebitId: MANDATE,
  ...over,
})

/* ------------------------------------------------------------------ *
 * The happy path.
 * ------------------------------------------------------------------ */

describe('a renewal extends the subscription it belongs to', () => {
  it('grants, and reports that it granted', async () => {
    const res = await POST(req(renewalBody()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, granted: true, renewal: true, period: 'monthly' })
  })

  it('extends the agency the MANDATE resolved to', async () => {
    await POST(req(renewalBody()))
    expect(H.upgrade).toHaveBeenCalledTimes(1)
    const [agencyId, reason, , period] = H.upgrade.mock.calls[0] as any[]
    expect(agencyId).toBe(AGENCY_ID)
    expect(period).toBe('monthly')
    expect(reason).toBe(`grow:${CHARGE}`)
  })

  it('keeps the paid-period reason in the `grow:` form entitlement requires', async () => {
    await POST(req(renewalBody()))
    const [, reason] = H.upgrade.mock.calls[0] as any[]
    // isPaidPeriodActive treats a non-`grow:` reason as a never-expiring admin
    // grant. A renewal must not accidentally become one.
    expect(String(reason).startsWith('grow:')).toBe(true)
  })

  it('records the charge under the per-charge code, never the mandate', async () => {
    await POST(req(renewalBody()))
    const [table, row] = H.insert.mock.calls[0] as any[]
    expect(table).toBe('payments')
    expect(row).toEqual({ transactionId: CHARGE, agencyId: AGENCY_ID })
    expect(row.transactionId).not.toBe(MANDATE)
  })

  it('writes the payment row BEFORE extending, both inside one transaction', async () => {
    await POST(req(renewalBody()))
    expect(H.order).toEqual(['tx:begin', 'insert:payments', 'upgrade', 'tx:commit'])
  })

  it('logs the renewal as a repeatable activation event', async () => {
    await POST(req(renewalBody()))
    expect(H.track).toHaveBeenCalledTimes(1)
    expect((H.track.mock.calls[0] as any[])[0]).toMatchObject({
      agencyId: AGENCY_ID,
      event: 'subscription_activated',
      props: expect.objectContaining({ renewal: true, transactionId: CHARGE }),
    })
  })
})

/* ------------------------------------------------------------------ *
 * The mandate must never become the idempotency key.
 * ------------------------------------------------------------------ */

describe('the mandate identifies the subscription and nothing else', () => {
  it('a second renewal under a NEW code still grants — the mandate is unchanged', async () => {
    await POST(req(renewalBody({ transactionCode: 'charge-abc-002' })))
    await POST(req(renewalBody({ transactionCode: 'charge-abc-003' })))
    expect(H.upgrade).toHaveBeenCalledTimes(2)
    const keys = H.insert.mock.calls.map((c: any[]) => c[1].transactionId)
    expect(keys).toEqual(['charge-abc-002', 'charge-abc-003'])
    expect(new Set(keys).size).toBe(2)
  })

  it('refuses when the two identifiers are the same value', async () => {
    const res = await POST(req(renewalBody({ transactionCode: MANDATE })))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'ambiguous_identifiers' })
    expect(H.insert).not.toHaveBeenCalled()
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('never reads a mandate field into the idempotency key', () => {
    const src = code(ROUTE)
    // transactionCode is read from exactly one documented field, with no
    // mandate-shaped fallback anywhere in the expression.
    expect(src).toContain('const raw = payload?.transactionCode')
    expect(src).not.toMatch(/transactionCode[^\n]*\?\?[^\n]*[Dd]irectDebit/)
    expect(src).not.toMatch(/transactionId:\s*mandateId/)
    expect(src).toContain('transactionId: transactionCode')
  })

  it('does not invent an undocumented per-charge field', () => {
    const src = code(ROUTE)
    // `transactionId` belongs to the PaymentLinks schema, not option 6.
    expect(src).not.toMatch(/payload\??\.\s*transactionId/)
  })
})

/* ------------------------------------------------------------------ *
 * Fail closed.
 * ------------------------------------------------------------------ */

describe('a charge it cannot attribute grants nothing', () => {
  it('no subscription carries this mandate → no write', async () => {
    H.subRows.mockReturnValue([])
    const res = await POST(req(renewalBody()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ granted: false, reason: 'no_subscription_for_mandate' })
    expect(H.insert).not.toHaveBeenCalled()
    expect(H.upgrade).not.toHaveBeenCalled()
    expect(H.order).toEqual([])
  })

  it('several subscriptions carry it → refuses to pick one', async () => {
    H.subRows.mockReturnValue([{ agencyId: AGENCY_ID }, { agencyId: 5150 }])
    const res = await POST(req(renewalBody()))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'ambiguous_mandate' })
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('the payload carries no mandate at all → no write', async () => {
    const b = renewalBody()
    delete (b as any).directDebitId
    const res = await POST(req(b))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'missing_mandate' })
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it.each(['', '0', 'null', 'false', '-1'])('a placeholder mandate (%p) is not an identifier', async (v) => {
    const res = await POST(req(renewalBody({ directDebitId: v })))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'missing_mandate' })
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('no transactionCode → refuses rather than extend un-idempotently', async () => {
    const b = renewalBody()
    delete (b as any).transactionCode
    const res = await POST(req(b))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'missing_transaction_code' })
    expect(H.insert).not.toHaveBeenCalled()
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('resolves ONLY by mandate — no email or phone fallback', () => {
    const src = code(ROUTE)
    expect(src).toContain('where({ growDirectDebitId: mandateId })')
    expect(src).not.toContain('resolveByPayerEmail')
    expect(src).not.toContain('resolveByPayerPhone')
    expect(src).not.toContain('phoneCore')
  })

  it('requires exactly one match, not the first of several', () => {
    const src = code(ROUTE)
    expect(src).toContain('rows.length !== 1')
    expect(src).not.toMatch(/rows\[0\][^\n]*\|\|/)
  })
})

/* ------------------------------------------------------------------ *
 * Idempotency.
 * ------------------------------------------------------------------ */

describe('a redelivered charge changes nothing', () => {
  it('a duplicate transactionCode is reported, not re-granted', async () => {
    H.insert.mockImplementation(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    const res = await POST(req(renewalBody()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true })
  })

  it('a duplicate never reaches the upgrade — the insert guards it', async () => {
    H.insert.mockImplementation(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    await POST(req(renewalBody()))
    expect(H.upgrade).not.toHaveBeenCalled()
    expect(H.track).not.toHaveBeenCalled()
  })

  it('a genuine failure is a 500, never a silent success', async () => {
    H.upgrade.mockImplementation(async () => ({ error: 'not_found' }) as any)
    const res = await POST(req(renewalBody()))
    expect(res.status).toBe(500)
    expect(H.track).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * Authentication and input.
 * ------------------------------------------------------------------ */

describe('authentication', () => {
  it('a valid webhookKey is accepted', async () => {
    const res = await POST(req(renewalBody()))
    expect(res.status).toBe(200)
  })

  it('an invalid key is 401 and touches nothing', async () => {
    const res = await POST(req(renewalBody({ webhookKey: 'wrong-secret-value-of-same-shape' })))
    expect(res.status).toBe(401)
    expect(H.upgrade).not.toHaveBeenCalled()
    expect(H.order).toEqual([])
  })

  it('a missing key is rejected', async () => {
    const b = renewalBody()
    delete (b as any).webhookKey
    const res = await POST(req(b))
    expect(res.status).toBe(401)
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('an unset server secret refuses to process', async () => {
    vi.stubEnv('GROW_WEBHOOK_SECRET', '')
    vi.resetModules()
    const mod = await import('@/app/api/payments/grow/recurring/route')
    const res = await mod.POST(req(renewalBody()))
    expect(res.status).toBe(500)
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('authenticates before any DB access', () => {
    const src = code(ROUTE)
    const auth = src.indexOf('verifyWebhookSecret(payload)')
    const firstDb = src.indexOf("db('subscriptions')")
    expect(auth).toBeGreaterThan(-1)
    expect(firstDb).toBeGreaterThan(auth)
  })
})

describe('malformed and hostile input', () => {
  it('malformed JSON → 400, no write', async () => {
    const res = await POST(req('not json at all'))
    expect(res.status).toBe(400)
    expect(H.order).toEqual([])
  })

  it('a non-object body → 400', async () => {
    const res = await POST(req(JSON.stringify(42)))
    expect(res.status).toBe(400)
  })

  it('an empty object → 401, since it carries no key', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(401)
  })

  it('blocked outside production', async () => {
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.resetModules()
    const mod = await import('@/app/api/payments/grow/recurring/route')
    const res = await mod.POST(req(renewalBody()))
    expect(res.status).toBe(400)
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('a hostile agencyId in the payload is ignored — the mandate decides', async () => {
    H.subRows.mockReturnValue([{ agencyId: AGENCY_ID }])
    await POST(req(renewalBody({ agencyId: 9999, agency_id: 9999 })))
    expect((H.upgrade.mock.calls[0] as any[])[0]).toBe(AGENCY_ID)
  })
})

/* ------------------------------------------------------------------ *
 * Period selection.
 * ------------------------------------------------------------------ */

describe('a renewal keeps the period the subscription already has', () => {
  it('an annual subscription renews annually', async () => {
    H.resolution.mockReturnValue({
      period: 'monthly',
      resolvedBy: 'fallback',
      candidates: { payment_link_id: null, amount: null, pending_upgrade: null, existing_subscription: 'annual' },
    })
    await POST(req(renewalBody()))
    expect((H.upgrade.mock.calls[0] as any[])[3]).toBe('annual')
  })

  it('a stale abandoned upgrade intent does not change the renewal period', async () => {
    H.resolution.mockReturnValue({
      period: 'annual',
      resolvedBy: 'pending_upgrade',
      candidates: { payment_link_id: null, amount: null, pending_upgrade: 'annual', existing_subscription: 'monthly' },
    })
    await POST(req(renewalBody()))
    expect((H.upgrade.mock.calls[0] as any[])[3]).toBe('monthly')
  })

  it('refuses rather than guess when the subscription has no period on file', async () => {
    H.resolution.mockReturnValue({
      period: 'monthly',
      resolvedBy: 'fallback',
      candidates: { payment_link_id: null, amount: null, pending_upgrade: null, existing_subscription: null },
    })
    const res = await POST(req(renewalBody()))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'no_billing_period' })
    expect(H.upgrade).not.toHaveBeenCalled()
    expect(H.insert).not.toHaveBeenCalled()
    expect(H.order).toEqual([])
  })

  /**
   * The reason the period is read from the CANDIDATE and not the resolver's
   * verdict. With no period on the row, the resolver's top answer is the stale
   * intent — the one value that must never decide a renewal.
   */
  it('a stale intent cannot fill in for a missing subscription period', async () => {
    H.resolution.mockReturnValue({
      period: 'annual',
      resolvedBy: 'pending_upgrade',
      candidates: { payment_link_id: null, amount: null, pending_upgrade: 'annual', existing_subscription: null },
    })
    const res = await POST(req(renewalBody()))
    expect(await res.json()).toMatchObject({ granted: false, reason: 'no_billing_period' })
    expect(H.upgrade).not.toHaveBeenCalled()
  })

  it('reads the candidate, never the resolver verdict', () => {
    const src = code(ROUTE)
    expect(src).toContain('const period = resolution.candidates.existing_subscription')
    // no fallback of any shape back onto the resolver's chosen period
    expect(src).not.toMatch(/existing_subscription\s*\?\?/)
    expect(src).not.toMatch(/const period[^\n]*resolution\.period/)
  })
})

/* ------------------------------------------------------------------ *
 * Privacy and honesty.
 * ------------------------------------------------------------------ */

describe('logging', () => {
  it('logs no payer PII beyond a masked email, and never the secret', () => {
    const src = code(ROUTE)
    const logged = [...src.matchAll(/console\.(log|warn|error)\(([\s\S]*?)\n  \)/g)].map((m) => m[2]).join(' ')
    for (const bad of ['fullName', 'cardSuffix', 'cardBrand', 'payerPhone', 'webhookKey', 'asmachta']) {
      expect(logged, bad).not.toContain(bad)
    }
    expect(src).toContain('maskEmail(')
    expect(src).not.toMatch(/payerEmail:\s*payload\.payerEmail\b/)
  })

  it('an unattributable charge is logged loudly, since money moved and access did not', () => {
    const src = read(ROUTE)
    expect(src).toContain('RENEWAL NOT APPLIED')
    expect(src).toMatch(/console\.error\([\s\S]{0,120}RENEWAL NOT APPLIED/)
  })
})

/* ------------------------------------------------------------------ *
 * The other Grow endpoints are untouched by this one.
 * ------------------------------------------------------------------ */

describe('separation from the other Grow endpoints', () => {
  it('shares the security envelope rather than re-implementing it', () => {
    const src = code(ROUTE)
    expect(src).toContain("from '@/lib/payments/growWebhook'")
    expect(src).not.toContain('timingSafeEqual')
    expect(src).not.toContain('process.env.GROW_WEBHOOK_SECRET')
  })

  it('does not classify outcome or sequence — option 6 has no fields to classify', () => {
    const src = code(ROUTE)
    expect(src).not.toContain('classifyPaymentOutcome')
    expect(src).not.toContain('classifyPaymentSequence')
    expect(src).not.toMatch(/payload\??\.\s*(status|statusCode|err)\b/)
  })

  it('sends no first-activation email', () => {
    const src = code(ROUTE)
    expect(src).not.toMatch(/sendMail|thankYou|welcome/i)
  })
})
