// Grow webhook option 7 — "Failure recurring payments".
//
// The endpoint exists so a FAILED recurring charge can never be mistaken for a
// successful one. Option 7's payload is a different schema in a different case
// convention and carries none of the fields `classifyPaymentOutcome` reads, so
// routed through the transaction handler it would classify `unverifiable` —
// which on the recurring path means grant. These assert the structural
// guarantee: this route has no way to grant, extend, or revoke anything.
//
// No secrets are printed: the fake webhook secret is a local constant.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const read = (p: string) => fs.readFileSync(p, 'utf8')

/** Comments explain what the route must NOT do; assertions must read CODE. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const SECRET = 'test-only-webhook-secret-not-a-real-value'
const AGENCY_ID = 4242
const MANDATE = '778899'

const H = vi.hoisted(() => ({
  subSelect: vi.fn(() => [] as Array<{ agencyId: number }>),
  anyInsert: vi.fn(),
  anyUpdate: vi.fn(),
}))

/**
 * Knex double that records EVERY write. The point of this suite is that none
 * of them ever fire, so insert/update are captured globally rather than
 * per-table.
 */
vi.mock('@/config/db', () => {
  const table = (name: string) => {
    const chain: any = {
      where: () => chain,
      whereRaw: () => chain,
      whereIn: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      select: () => chain,
      first: async () => null,
      insert: (...a: unknown[]) => H.anyInsert(name, ...a),
      update: (...a: unknown[]) => H.anyUpdate(name, ...a),
      then: (res: any, rej: any) => Promise.resolve(H.subSelect()).then(res, rej),
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
  vi.stubEnv('GROW_RECURRING_FAILURE_WEBHOOK_SECRET', SECRET)
  H.subSelect.mockReturnValue([])
  ;({ POST } = await import('@/app/api/payments/grow/recurring-failure/route'))
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

/** The documented option 7 payload. Values are synthetic; the KEYS are Grow's. */
const failureBody = (over: Record<string, unknown> = {}) => ({
  regular_payment_id: MANDATE,
  payer_name: 'Synthetic Payer',
  phone: '0500000000',
  email: 'payer@example.test',
  transaction_type: 'אשראי',
  card_suffix: '0000',
  sum: 1,
  description: 'SocialCRM Pro',
  business_title: 'SocialCRM',
  error_message: 'card declined by issuer',
  charges_attempts: 2,
  webhook_key: SECRET,
  ...over,
})

/* ------------------------------------------------------------------ *
 * Authentication.
 * ------------------------------------------------------------------ */

describe('authentication uses the same secret, under option 7 spelling', () => {
  it('accepts the documented snake_case webhook_key', async () => {
    const res = await POST(req(failureBody()))
    expect(res.status).toBe(200)
  })

  it('rejects an invalid key with 401', async () => {
    const res = await POST(req(failureBody({ webhook_key: 'wrong-secret-value-of-the-same-shape' })))
    expect(res.status).toBe(401)
  })

  it('rejects a missing key', async () => {
    const body = failureBody()
    delete (body as any).webhook_key
    const res = await POST(req(body))
    expect(res.status).toBe(401)
  })

  it('refuses the INITIAL webhook secret', async () => {
    vi.stubEnv('GROW_WEBHOOK_SECRET', 'initial-endpoint-secret-value')
    const res = await POST(req(failureBody({ webhook_key: 'initial-endpoint-secret-value' })))
    expect(res.status).toBe(401)
  })

  it('refuses the RECURRING webhook secret', async () => {
    vi.stubEnv('GROW_RECURRING_WEBHOOK_SECRET', 'recurring-endpoint-secret-value')
    const res = await POST(req(failureBody({ webhook_key: 'recurring-endpoint-secret-value' })))
    expect(res.status).toBe(401)
  })

  it('refuses to process when the server secret is unset', async () => {
    vi.stubEnv('GROW_RECURRING_FAILURE_WEBHOOK_SECRET', '')
    vi.resetModules()
    const mod = await import('@/app/api/payments/grow/recurring-failure/route')
    const res = await mod.POST(req(failureBody()))
    expect(res.status).toBe(500)
  })

  it('compares the secret in constant time, via the shared helper', () => {
    const shared = read('lib/payments/growWebhook.ts')
    expect(shared).toContain('timingSafeEqual')
    expect(shared).toContain('ab.length === bb.length && timingSafeEqual(ab, bb)')
    const route = read('app/api/payments/grow/recurring-failure/route.ts')
    expect(route).toContain('verifyWebhookSecret(payload,')
    // no hand-rolled second implementation
    expect(route).not.toContain('timingSafeEqual')
  })
})

/* ------------------------------------------------------------------ *
 * The guarantee: this route cannot grant, extend or revoke.
 * ------------------------------------------------------------------ */

describe('a failure notification mutates nothing', () => {
  it('writes no row on a matched failure', async () => {
    H.subSelect.mockReturnValue([{ agencyId: AGENCY_ID }])
    const res = await POST(req(failureBody()))
    expect(res.status).toBe(200)
    expect(H.anyInsert).not.toHaveBeenCalled()
    expect(H.anyUpdate).not.toHaveBeenCalled()
  })

  it('writes no row on an unmatched failure', async () => {
    H.subSelect.mockReturnValue([])
    const res = await POST(req(failureBody({ regular_payment_id: 'unknown-mandate' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ granted: false, matched: false })
    expect(H.anyInsert).not.toHaveBeenCalled()
    expect(H.anyUpdate).not.toHaveBeenCalled()
  })

  it('imports nothing that could grant or extend', () => {
    const route = code('app/api/payments/grow/recurring-failure/route.ts')
    for (const forbidden of [
      'performAgencyUpgrade',
      'expiresAt',
      "'payments'",
      'planReason',
      'agencies',
      'classifyPaymentOutcome',
      'resolveBillingPeriod',
    ]) {
      expect(route, forbidden).not.toContain(forbidden)
    }
  })

  it('never revokes the paid period it did not pay for', () => {
    const route = code('app/api/payments/grow/recurring-failure/route.ts')
    expect(route).not.toMatch(/plan:\s*'free'|expiresAt|trialExempt|\.update\(/)
  })

  it('a duplicate failure delivery is harmless', async () => {
    H.subSelect.mockReturnValue([{ agencyId: AGENCY_ID }])
    const a = await POST(req(failureBody()))
    const b = await POST(req(failureBody()))
    expect([a.status, b.status]).toEqual([200, 200])
    expect(H.anyInsert).not.toHaveBeenCalled()
    expect(H.anyUpdate).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ *
 * Subscription identification.
 * ------------------------------------------------------------------ */

describe('the subscription is identified only when it is deterministic', () => {
  it('a single growDirectDebitId match resolves the agency', async () => {
    H.subSelect.mockReturnValue([{ agencyId: AGENCY_ID }])
    const res = await POST(req(failureBody()))
    expect(await res.json()).toMatchObject({ matched: true })
  })

  it('several matches resolve nothing — a data problem is not a choice', async () => {
    H.subSelect.mockReturnValue([{ agencyId: AGENCY_ID }, { agencyId: 5150 }])
    const res = await POST(req(failureBody()))
    expect(await res.json()).toMatchObject({ matched: false })
  })

  it.each(['', '0', 'null', 'false', '-1'])(
    'a placeholder mandate id (%p) is not an identifier',
    async (v) => {
      H.subSelect.mockReturnValue([{ agencyId: AGENCY_ID }])
      const res = await POST(req(failureBody({ regular_payment_id: v })))
      expect(await res.json()).toMatchObject({ matched: false })
    },
  )

  it('resolves by mandate only — no email or phone fallback here', () => {
    const route = code('app/api/payments/grow/recurring-failure/route.ts')
    expect(route).toContain("where({ growDirectDebitId: mandateId })")
    expect(route).not.toContain('resolveByPayerEmail')
    expect(route).not.toContain('resolveByPayerPhone')
  })
})

/* ------------------------------------------------------------------ *
 * Robustness and privacy.
 * ------------------------------------------------------------------ */

describe('malformed input and logging', () => {
  it('malformed JSON is rejected safely', async () => {
    const res = await POST(req('not json at all'))
    expect(res.status).toBe(400)
    expect(H.anyInsert).not.toHaveBeenCalled()
  })

  it('a non-object body is rejected safely', async () => {
    const res = await POST(req(JSON.stringify(42)))
    expect(res.status).toBe(400)
  })

  it('is blocked outside production, like the transaction webhook', async () => {
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('GROW_MODE', 'sandbox')
    vi.resetModules()
    const mod = await import('@/app/api/payments/grow/recurring-failure/route')
    const res = await mod.POST(req(failureBody()))
    expect(res.status).toBe(400)
  })

  it('logs no payer PII and no secret', () => {
    const src = read('app/api/payments/grow/recurring-failure/route.ts')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const logged = [...code.matchAll(/console\.(log|warn|error)\(([\s\S]*?)\n  \)/g)].map((m) => m[2]).join(' ')
    for (const bad of ['payer_name', 'card_suffix', 'webhook_key', 'phone:']) {
      expect(logged, bad).not.toContain(bad)
    }
    expect(src).toContain('payerEmail: maskEmail(')
  })

  it('draws no conclusion Grow does not document', () => {
    const body = code('app/api/payments/grow/recurring-failure/route.ts')
    // charges_attempts is passed through verbatim, never compared or acted on
    expect(body).not.toMatch(/charges_attempts\s*[><=]=?/)
    // no inference that a failure means cancellation or that Grow will retry
    expect(body).not.toMatch(/cancel|retry/i)
  })
})
