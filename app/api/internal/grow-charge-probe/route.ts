import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { assertGrowRuntime } from '@/lib/payments/grow/config'
import { safeEqual } from '@/lib/payments/grow/constantTime'
import { chargeToken, lookupTokenTransactionsRaw } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { decryptCardToken, getActivePaymentMethod } from '@/db/payments/paymentMethods'
import { CHARGE_DESCRIPTION } from '@/lib/payments/cardTrial/terms'

/**
 * TEMPORARY, owner-authorized (2026-09-17). DELETE once the three sandbox
 * observations are recorded — it exists only because opening the
 * tokenChargeDispatch gate requires evidence that only a charge can produce,
 * and the ordinary cron path is itself gated on that same evidence.
 *
 * Every limit is deliberate:
 *   - staging + sandbox only, via assertGrowRuntime and an explicit APP_ENV check;
 *   - Bearer CRON_SECRET, compared in constant time — never unauthenticated;
 *   - pinned to ONE agency, ONE payment method and ONE amount, all constants
 *     below, so it cannot be pointed at another card or a larger sum;
 *   - DURABLY single-use: the attempt identifier is written to analytics_events
 *     BEFORE the request leaves, so a timeout, a retry or a second invocation
 *     re-reads it and refuses to issue a new charge.
 */

const AGENCY_ID = 6
const PAYMENT_METHOD_ID = 11
const SUM_ILS = 1
const ATTEMPT_EVENT = 'charge_probe_attempt'
const LOG = '[ChargeProbe]'

type Step = 'charge' | 'duplicate' | 'lookup'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  if (secret.length < 16) return false
  const presented = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return presented.length > 0 && safeEqual(presented, secret)
}

/** The one attempt, if it has already been made. Read before anything is sent. */
async function priorAttempt(): Promise<{ uniqueIdentifier: number; groupIdentifier: number } | null> {
  const row = await db('analytics_events').where({ agencyId: AGENCY_ID, event: ATTEMPT_EVENT }).orderBy('id', 'asc').first('props')
  if (!row) return null
  const p = row.props as { uniqueIdentifier?: number; groupIdentifier?: number }
  return p?.uniqueIdentifier ? { uniqueIdentifier: Number(p.uniqueIdentifier), groupIdentifier: Number(p.groupIdentifier) } : null
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return new NextResponse('Not found', { status: 404 })
  if (process.env.APP_ENV !== 'staging') return NextResponse.json({ error: 'staging_only' }, { status: 403 })
  try {
    const runtime = assertGrowRuntime()
    if (runtime.mode !== 'sandbox') return NextResponse.json({ error: 'sandbox_only' }, { status: 403 })
  } catch (err) {
    return NextResponse.json({ error: 'runtime_not_allowed', detail: String(err) }, { status: 403 })
  }

  const step = (req.nextUrl.searchParams.get('step') ?? '') as Step
  const method = await getActivePaymentMethod(AGENCY_ID)
  if (!method || method.id !== PAYMENT_METHOD_ID) {
    return NextResponse.json({ error: 'active_method_is_not_the_approved_card', activeId: method?.id ?? null }, { status: 409 })
  }
  const cardToken = decryptCardToken(method)
  const prior = await priorAttempt()

  if (step === 'charge') {
    if (prior) return NextResponse.json({ error: 'already_attempted', ...prior, note: 'single-use: re-run step=lookup to read the outcome' }, { status: 409 })
    const uniqueIdentifier = Math.floor(Date.now() / 1000)
    const groupIdentifier = uniqueIdentifier + 1
    // Persisted BEFORE the request leaves: a timeout must not licence a second charge.
    await track({ agencyId: AGENCY_ID, event: ATTEMPT_EVENT, props: { uniqueIdentifier, groupIdentifier, sum: SUM_ILS } })
    try {
      const result = await chargeToken({ cardToken, holder: method.holder, sum: SUM_ILS, description: CHARGE_DESCRIPTION, uniqueIdentifier, groupIdentifier })
      console.log(`${LOG} charge`, { kind: result.kind })
      return NextResponse.json({ step, uniqueIdentifier, groupIdentifier, result })
    } catch (err) {
      const reason = err instanceof GrowTransportError ? `transport_${err.reason}` : 'unexpected'
      return NextResponse.json({ step, uniqueIdentifier, groupIdentifier, outcome: 'unknown', reason }, { status: 200 })
    }
  }

  if (step === 'duplicate') {
    if (!prior) return NextResponse.json({ error: 'no_original_attempt' }, { status: 409 })
    try {
      // The SAME identifier on purpose — this is the duplicate-refusal probe.
      const result = await chargeToken({ cardToken, holder: method.holder, sum: SUM_ILS, description: CHARGE_DESCRIPTION, ...prior })
      return NextResponse.json({ step, ...prior, result })
    } catch (err) {
      const reason = err instanceof GrowTransportError ? `transport_${err.reason}` : 'unexpected'
      return NextResponse.json({ step, ...prior, outcome: 'unknown', reason }, { status: 200 })
    }
  }

  if (step === 'lookup') {
    if (!prior) return NextResponse.json({ error: 'no_original_attempt' }, { status: 409 })
    const env = await lookupTokenTransactionsRaw({ cardToken, identifier: { uniqueIdentifier: prior.uniqueIdentifier } })
    return NextResponse.json({ step, uniqueIdentifier: prior.uniqueIdentifier, envelope: env })
  }

  return NextResponse.json({ error: 'unknown_step' }, { status: 400 })
}
