import { NextRequest, NextResponse, after } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/config/db'
import { verifyToken } from '@/lib/payments/token'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { agencyOwner } from '@/lib/emailAutomations/recipients'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { resolveBillingPeriod, logPeriodResolution, type PeriodResolution } from '@/lib/payments/resolvePeriod'
import { classifyPaymentOutcome, isRecurringRun } from '@/lib/payments/paymentOutcome'

const PG_UNIQUE_VIOLATION = '23505'

/**
 * TEMPORARY DIAGNOSTIC — REMOVE ONCE THE RECURRING CLASSIFICATION IS SETTLED.
 *
 * WHY THIS EXISTS. Transaction GvNe/kVpyRfBqOuIks4kXA== was the FIRST charge of
 * a monthly הוראת קבע subscription. It was refused as
 * `unverifiable + recurring`, and we could not tell whether that verdict was
 * right, because the handler only ever logged payload KEYS. Two separate
 * root-cause analyses were argued from the key list alone; the first was wrong.
 * Values are the missing evidence, and guessing at them has already cost a
 * wrong diagnosis and a wrong fix.
 *
 * WHAT IS SAFE TO LOG. Only the fields that feed the classification decision.
 * Everything identifying the payer or the instrument is deliberately absent:
 * payerEmail, payerPhone, fullName, ip, cardSuffix, cardBin, cardBrand,
 * cardType — and webhookKey, which is the shared secret. `asmachta` is the
 * acquirer approval number, not a card or personal identifier.
 *
 * THIS DECIDES NOTHING. It reads values and prints them. The classification,
 * the entitlement path and the response are computed exactly as before, and no
 * database record is written on account of it.
 */
const DIAGNOSTIC_FIELDS = [
  'paymentType',
  'transactionType',
  'status',
  'statusCode',
  'asmachta',
  'directDebitId',
  'paymentsNum',
  'allPaymentNum',
  'firstPaymentSum',
  'periodicalPaymentSum',
] as const

function classificationFields(payload: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of DIAGNOSTIC_FIELDS) out[k] = payload?.[k]
  return out
}

type AppEnv = 'local' | 'staging' | 'test' | 'production'
type GrowMode = 'sandbox' | 'production'

function isAppEnv(value: string | undefined): value is AppEnv {
  return value === 'local' || value === 'staging' || value === 'test' || value === 'production'
}

function isGrowMode(value: string | undefined): value is GrowMode {
  return value === 'sandbox' || value === 'production'
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function assertWebhookEnv(host: string): { env: AppEnv; mode: GrowMode } {
  const ENV = process.env.APP_ENV
  const MODE = process.env.GROW_MODE

  if (!isAppEnv(ENV)) {
    throw new Error('🚨 APP_ENV must be local, staging, test, or production')
  }
  if (!isGrowMode(MODE)) {
    throw new Error('🚨 GROW_MODE must be sandbox or production')
  }
  if (ENV === 'local' && MODE !== 'sandbox') {
    throw new Error('🚨 LOCAL must use sandbox payments')
  }
  if (ENV === 'staging' && MODE !== 'sandbox') {
    throw new Error('🚨 STAGING must use sandbox payments')
  }
  if (ENV === 'test' && MODE !== 'sandbox') {
    throw new Error('🚨 TEST must use sandbox payments')
  }
  if (ENV === 'production' && MODE !== 'production') {
    throw new Error('🚨 PROD must use real payments')
  }
  if (ENV === 'production') {
    const appHost = process.env.APP_HOST
    if (!appHost || !host.includes(appHost)) {
      throw new Error('🚨 Host mismatch in production')
    }
  }

  return { env: ENV, mode: MODE }
}

/**
 * Deterministic ownership by the payer's email — the resolver that already
 * existed inline for the "no token" case, lifted out so the expired-token path
 * can reuse it VERBATIM rather than growing a second copy.
 *
 * Unchanged semantics: lower-cased exact match against a still-`pending`
 * upgrade row, newest first. The old "sole pending row" heuristic stays gone —
 * it attributed a payment to an agency that did not demonstrably make it.
 * Returns null when ownership cannot be established, and the caller refuses.
 */
async function resolveByPayerEmail(payload: any): Promise<number | null> {
  const rawEmail = payload?.payerEmail ?? payload?.payer_email ?? payload?.email
  const payerEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!payerEmail) return null

  const pending = await db('pending_upgrades')
    .whereRaw('lower(email) = ?', [payerEmail])
    .where({ status: 'pending' })
    .orderBy('createdAt', 'desc')
    .first()

  return pending ? pending.agencyId : null
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') || ''
  console.log('💳 ENV CHECK:', {
    env: process.env.APP_ENV,
    mode: process.env.GROW_MODE,
    host,
  })

  // 1. Environment guard
  let envInfo: { env: AppEnv; mode: GrowMode }
  try {
    envInfo = assertWebhookEnv(host)
  } catch (err) {
    console.error('[GrowWebhook] env guard tripped', { err: String(err) })
    return new NextResponse('Webhook misconfigured', { status: 500 })
  }

  if (envInfo.env !== 'production') {
    console.warn('⚠️ Webhook blocked outside production')
    return new Response('Webhook disabled', { status: 400 })
  }

  const raw = await req.text()
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  const payload = body?.data ?? body
  console.log('[GrowWebhook] payload keys:', Object.keys(payload || {}))

  // Authenticate the webhook BEFORE any business logic runs. The shared
  // webhookKey secret is the only proof the request genuinely came from Grow —
  // the identifyParam token is visible to the user in their payment URL and is
  // NOT proof of payment. Verification is mandatory: a missing or invalid
  // webhookKey is rejected here, before any DB read or ownership resolution.
  const secret = process.env.GROW_WEBHOOK_SECRET
  if (!secret) {
    console.error('[GrowWebhook] GROW_WEBHOOK_SECRET is not set — refusing to process')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const webhookKey: unknown = payload?.webhookKey ?? payload?.webhook_key
  if (typeof webhookKey !== 'string' || !safeEqual(webhookKey, secret)) {
    console.warn('[GrowWebhook] rejected: missing or invalid webhookKey')
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const transactionId: unknown = payload?.transactionId ?? payload?.transactionCode
  const externalId: unknown = payload?.externalId ?? payload?.external_id ?? payload?.identifyParam

  console.log('[GrowWebhook] resolved fields:', {
    webhookKey: webhookKey ? 'present' : 'absent',
    transactionId,
    externalId,
  })

  // TEMPORARY DIAGNOSTIC. Authenticated requests only — a forged payload never
  // reaches this line. See classificationFields for what is and is not logged.
  console.log('[GrowWebhook] classification fields:', classificationFields(payload))

  // 5. Required-fields gate.
  // Required-fields gate. transactionId is non-negotiable (idempotency key
  // for the payments UNIQUE constraint). externalId is now allowed to be
  // empty so the pending_upgrades fallback (below) can resolve agencyId
  // by payerEmail when Grow doesn't echo our token back.
  if (typeof transactionId !== 'string' || !transactionId) {
    return new NextResponse('Missing fields', { status: 400 })
  }

  /**
   * PROOF OF PAYMENT, before any entitlement work.
   *
   * The handler used to grant a billing period to any authenticated payload
   * with a fresh transactionId — it never looked at the payment result. Harmless
   * while Grow delivers only successful one-time transactions; a real hole the
   * moment "ריצות הוראת קבע" is enabled, because a FAILED standing-order run
   * would buy the customer another month.
   *
   * `not_success` and `pending` are always refused. `unverifiable` (no usable
   * status field — where today's real, working PaymentLinks webhooks land) is
   * refused ONLY for a recurring run: that surface is new and unproven, so it
   * must prove success, while the one-time path keeps the behaviour that is
   * currently correct in production. See lib/payments/paymentOutcome.ts for why
   * this is not a blanket "status must equal success" check — that exact check
   * caused an outage.
   *
   * REFUSING A PENDING CHARGE IS NOT FINAL FOR THAT CHARGE. This runs BEFORE
   * the `payments` insert, so the transaction id is never consumed by a refusal:
   * if the same charge later settles and Grow sends a confirmed webhook, it is
   * processed and granted normally. Refusing early costs the customer nothing
   * and stops an unfinished payment from buying a billing period.
   *
   * 200, not 4xx: the decision is final for THIS delivery, so Grow should not
   * retry it. `granted` makes the refusal explicit and greppable rather than
   * looking like a success.
   */
  const outcome = classifyPaymentOutcome(body, payload)
  const recurring = isRecurringRun(payload)
  if (outcome === 'not_success' || outcome === 'pending' || (outcome === 'unverifiable' && recurring)) {
    console.warn('[GrowWebhook] refusing to grant — payment not confirmed', {
      transactionId,
      outcome,
      recurring,
    })
    return NextResponse.json({ ok: true, granted: false, reason: outcome })
  }
  if (outcome === 'unverifiable') {
    console.warn('[GrowWebhook] no payment status on a non-recurring payload — granting on legacy behaviour', {
      transactionId,
    })
  }

  console.log('[GrowWebhook] processing transaction:', transactionId)

  // Resolve agencyId. Two paths:
  //   1) Existing token flow — externalId present → HMAC verify (unchanged)
  //   2) NEW fallback — externalId empty → look up most recent pending
  //      upgrade by payerEmail.
  let agencyId: number
  if (typeof externalId === 'string' && externalId.trim()) {
    try {
      agencyId = verifyToken(externalId).agencyId
      console.log('[GrowWebhook] token verified')
    } catch (err) {
      /**
       * EXPIRY IS NOT FORGERY.
       *
       * The token carries a 1-hour TTL, so any charge that is not the checkout
       * itself — a renewal above all — arrives with a correctly SIGNED but
       * expired token. Returning 400 here threw that payment away before the
       * payerEmail resolver below ever ran.
       *
       * Only expiry falls through. A bad signature is still refused on the spot:
       * that is a forgery attempt, and letting it reach the fallback would be a
       * weakening rather than a fix.
       */
      const expired = String(err).includes('Token expired')
      if (!expired) {
        console.log('[GrowWebhook] token verification failed:', String(err))
        return new NextResponse('Invalid token', { status: 400 })
      }
      console.warn('[GrowWebhook] token expired — falling through to payer-email resolution', { transactionId })
      agencyId = await resolveByPayerEmail(payload)
      if (agencyId == null) {
        return new NextResponse('Pending upgrade not found', { status: 404 })
      }
    }
  } else {
    // No signed token in the payload — resolve ownership deterministically by
    // the payer's email. The previous "sole pending row" fallback (upgrade the
    // only pending agency when nothing else matched) is removed: it attributes
    // a payment to an agency that did not demonstrably make it. If ownership
    // cannot be matched deterministically, no upgrade occurs.
    console.log('[GrowWebhook] token missing, resolving by payer email')
    const resolved = await resolveByPayerEmail(payload)
    if (resolved == null) {
      console.error('[GrowWebhook] no deterministic owner match (no token, no matching pending email)')
      return new NextResponse('Pending upgrade not found', { status: 404 })
    }
    agencyId = resolved
  }

  // Captured BEFORE the upgrade flips plan to 'pro', so the analytics event
  // records which state the agency converted from. Read failure must never
  // block a payment — default to 'unknown'.
  let fromState = 'unknown'
  try {
    const trialRow = await getAgencyTrial(agencyId)
    if (trialRow) fromState = getTrialState(trialRow, new Date()).status
  } catch {}

  // Billing-period classification (5-rule chain, lib/payments/resolvePeriod).
  // Safety requirement: never fail the payment, never block access, never
  // throw — a resolution failure grants monthly and logs loudly.
  let resolution: PeriodResolution = {
    period: 'monthly',
    resolvedBy: 'fallback',
    candidates: { payment_link_id: null, amount: null, pending_upgrade: null, existing_subscription: null },
  }
  try {
    resolution = await resolveBillingPeriod(agencyId, payload)
  } catch (err) {
    console.error('[GrowWebhook] period resolution crashed — defaulting to monthly', {
      agencyId,
      transactionId,
      err: String(err),
    })
  }
  try {
    logPeriodResolution({ agencyId, transactionId, payload }, resolution)
  } catch {}

  console.log('[GrowWebhook] before transaction')
  try {
    await db.transaction(async (trx) => {
      await trx('payments').insert({ transactionId, agencyId })
      const result = await performAgencyUpgrade(agencyId, `grow:${transactionId}`, trx, resolution.period)
      if ('error' in result) throw new Error(`upgrade_failed:${result.error}`)
    })
  } catch (err: any) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[GrowWebhook] processing failed', { transactionId, agencyId, err: String(err) })
    return new NextResponse('Processing error', { status: 500 })
  }

  // Post-commit on purpose: an analytics failure must never roll back a
  // payment. track() also never throws.
  await track({
    agencyId,
    event: 'subscription_activated',
    props: { transactionId, fromState, period: resolution.period, periodResolvedBy: resolution.resolvedBy },
  })

  // After successful upgrade, mark the pending entry as completed.
  // Uses `db` (not `trx`) — runs after the upgrade transaction commits.
  // Non-atomic with the upgrade by design; if this UPDATE fails, the
  // upgrade still stands and pending stays 'pending' (recoverable, harmless
  // since the next webhook for this agency would also succeed).
  await db('pending_upgrades').where({ agencyId }).update({
    status: 'completed',
    updatedAt: new Date(),
  })

  // Thank-you email for the FIRST activation. Dispatched only here — after the
  // upgrade transaction has committed — so an email can never imply a payment
  // that did not land. Deferred with after() so Resend latency never delays the
  // webhook response, and fully guarded: an email failure must not fail a paid
  // transaction. Renewals re-enter this path with a new transactionId, but the
  // engine's per-user claim is already taken, so the dispatcher skips them.
  after(async () => {
    try {
      const recipient = await agencyOwner(agencyId)
      if (!recipient) {
        console.warn('[GrowWebhook] subscription.activated: no owner resolved', { agencyId })
        return
      }
      await dispatchLifecycleEvent('subscription.activated', recipient, new Date())
    } catch (err) {
      console.error('[GrowWebhook] subscription.activated dispatch failed', { agencyId, err: String(err) })
    }
  })

  return NextResponse.json({ ok: true })
}
