import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/config/db'
import { verifyToken } from '@/lib/payments/token'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { agencyOwner } from '@/lib/emailAutomations/recipients'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { resolveBillingPeriod, logPeriodResolution, type PeriodResolution } from '@/lib/payments/resolvePeriod'
import { classifyPaymentOutcome, classifyPaymentMode, classifyPaymentSequence } from '@/lib/payments/paymentOutcome'
import { phoneCore } from '@/lib/leads/normalizeContact'
import {
  assertWebhookEnv,
  unwrapPayload,
  verifyWebhookSecret,
  readMandateId,
  maskEmail,
} from '@/lib/payments/growWebhook'

const PG_UNIQUE_VIOLATION = '23505'

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

/**
 * SECONDARY ownership signal: the payer's phone against the phones already on
 * record for agencies that are waiting for a payment.
 *
 * WHY THIS EXISTS. Two real charges were taken and neither activated. Grow does
 * not echo `identifyParam` back on this link type, so the signed token — the
 * only deterministic signal — arrives empty every time, and ownership rests
 * entirely on `payerEmail`, a free-text field the payer types at checkout. When
 * that differs from the account email by even one character, a paid customer
 * gets a 404.
 *
 * WHY IT IS STILL NOT A GUESS. Candidates are drawn ONLY from rows that are
 * already `status='pending'` — an agency that demonstrably started a checkout —
 * and the match must be UNIQUE. Two candidates, or none, resolve to null and
 * the caller refuses. This is emphatically not the "sole pending agency"
 * heuristic that was removed: that one attributed a payment to whoever happened
 * to be waiting; this one requires the payer's own phone to match that agency's
 * own phone.
 *
 * `phoneCore` is the existing normaliser (last 9 significant digits), so
 * `053-531-7356`, `0535317356` and `972535317356` all compare equal — the same
 * convention lead de-duplication already uses.
 *
 * Coverage is honestly partial: at the time of writing only 2 of 6 pending
 * agencies have a phone on record anywhere. This narrows the failure, it does
 * not close it. The real repair is getting the token to round-trip.
 */
async function resolveByPayerPhone(payload: any): Promise<{ agencyId: number | null; candidates: number }> {
  const raw = payload?.payerPhone ?? payload?.payer_phone ?? payload?.phone
  const core = phoneCore(typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null)
  if (!core) return { agencyId: null, candidates: 0 }

  const pending = await db('pending_upgrades')
    .leftJoin('agencies', 'agencies.id', 'pending_upgrades.agencyId')
    .where('pending_upgrades.status', 'pending')
    .select('pending_upgrades.agencyId as agencyId', 'agencies.phone as agencyPhone')

  if (pending.length === 0) return { agencyId: null, candidates: 0 }

  const agencyIds = pending.map((r: any) => r.agencyId)
  const users = await db('users').whereIn('agencyId', agencyIds).select('agencyId', 'phone')

  const matched = new Set<number>()
  for (const row of pending) {
    if (phoneCore(row.agencyPhone) === core) matched.add(row.agencyId)
  }
  for (const u of users) {
    if (phoneCore((u as any).phone) === core) matched.add((u as any).agencyId)
  }

  // Exactly one, or nothing. Ambiguity is refused, never resolved.
  const ids = [...matched]
  return { agencyId: ids.length === 1 ? ids[0] : null, candidates: ids.length }
}

/**
 * Ownership, in strict order of authority: token → email → phone.
 *
 * A valid token is never overridden. The phone signal is consulted only as a
 * fallback, and when BOTH email and phone resolve to DIFFERENT agencies the
 * payment is refused rather than attributed to either — a disagreement between
 * two weak signals is not evidence, it is a reason to stop.
 */
async function resolveOwner(payload: any): Promise<{ agencyId: number | null; via: 'email' | 'phone' | 'none'; conflict?: boolean; phoneCandidates: number }> {
  const byEmail = await resolveByPayerEmail(payload)
  const byPhone = await resolveByPayerPhone(payload)

  if (byEmail != null && byPhone.agencyId != null && byEmail !== byPhone.agencyId) {
    return { agencyId: null, via: 'none', conflict: true, phoneCandidates: byPhone.candidates }
  }
  if (byEmail != null) return { agencyId: byEmail, via: 'email', phoneCandidates: byPhone.candidates }
  if (byPhone.agencyId != null) return { agencyId: byPhone.agencyId, via: 'phone', phoneCandidates: byPhone.candidates }
  return { agencyId: null, via: 'none', phoneCandidates: byPhone.candidates }
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') || ''
  console.log('💳 ENV CHECK:', {
    env: process.env.APP_ENV,
    mode: process.env.GROW_MODE,
    host,
  })

  // 1. Environment guard
  let envInfo: ReturnType<typeof assertWebhookEnv>
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

  const payload = unwrapPayload(body)
  console.log('[GrowWebhook] payload keys:', Object.keys(payload || {}))

  // Authenticate the webhook BEFORE any business logic runs. The shared
  // webhookKey secret is the only proof the request genuinely came from Grow —
  // the identifyParam token is visible to the user in their payment URL and is
  // NOT proof of payment. Verification is mandatory: a missing or invalid
  // webhookKey is rejected here, before any DB read or ownership resolution.
  const auth = verifyWebhookSecret(payload)
  if (auth.ok === false) {
    if (auth.reason === 'not_configured') {
      console.error('[GrowWebhook] GROW_WEBHOOK_SECRET is not set — refusing to process')
      return new NextResponse('Server misconfigured', { status: 500 })
    }
    console.warn('[GrowWebhook] rejected: missing or invalid webhookKey')
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const webhookKey: unknown = payload?.webhookKey ?? payload?.webhook_key

  const transactionId: unknown = payload?.transactionId ?? payload?.transactionCode
  const externalId: unknown = payload?.externalId ?? payload?.external_id ?? payload?.identifyParam

  console.log('[GrowWebhook] resolved fields:', {
    webhookKey: webhookKey ? 'present' : 'absent',
    transactionId,
    externalId,
  })

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
  const mode = classifyPaymentMode(payload)
  const sequence = classifyPaymentSequence(payload, mode)

  /**
   * An unverifiable charge is refused only when it is a standing order whose
   * position in the series we cannot establish.
   *
   * The INITIAL charge of a subscription is granted on the same basis as a
   * one-time payment. Grow's transaction webhook carries no status field at
   * all, and charge #2 onward arrives through a different subscription
   * entirely, so refusing every standing-order charge here did not fail closed
   * on a doubtful payment — it refused every activation the product has.
   */
  const unprovenCharge = sequence !== 'initial'
  if (outcome === 'not_success' || outcome === 'pending' || (outcome === 'unverifiable' && unprovenCharge)) {
    console.warn('[GrowWebhook] refusing to grant — payment not confirmed', {
      transactionId,
      outcome,
      mode,
      sequence,
    })
    return NextResponse.json({ ok: true, granted: false, reason: outcome })
  }
  if (outcome === 'unverifiable') {
    console.warn('[GrowWebhook] no payment status on this payload — granting on the compatibility path', {
      transactionId,
      mode,
      sequence,
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
      console.warn('[GrowWebhook] token expired — falling through to payer identity resolution', { transactionId })
      const resolvedExpired = await resolveOwner(payload)
      if (resolvedExpired.agencyId == null) {
        console.error('[GrowWebhook] no deterministic owner match (expired token)', {
          transactionId,
          payerEmail: maskEmail(payload?.payerEmail ?? payload?.payer_email ?? payload?.email),
          phoneCandidates: resolvedExpired.phoneCandidates,
          conflict: Boolean(resolvedExpired.conflict),
        })
        return new NextResponse('Pending upgrade not found', { status: 404 })
      }
      agencyId = resolvedExpired.agencyId
      console.log('[GrowWebhook] owner resolved', { transactionId, via: resolvedExpired.via })
    }
  } else {
    // No signed token in the payload — resolve ownership deterministically by
    // the payer's email. The previous "sole pending row" fallback (upgrade the
    // only pending agency when nothing else matched) is removed: it attributes
    // a payment to an agency that did not demonstrably make it. If ownership
    // cannot be matched deterministically, no upgrade occurs.
    console.log('[GrowWebhook] token missing, resolving by payer identity')
    const resolved = await resolveOwner(payload)
    if (resolved.agencyId == null) {
      console.error('[GrowWebhook] no deterministic owner match (no token)', {
        transactionId,
        payerEmail: maskEmail(payload?.payerEmail ?? payload?.payer_email ?? payload?.email),
        phoneCandidates: resolved.phoneCandidates,
        conflict: Boolean(resolved.conflict),
      })
      return new NextResponse('Pending upgrade not found', { status: 404 })
    }
    agencyId = resolved.agencyId
    console.log('[GrowWebhook] owner resolved', { transactionId, via: resolved.via })
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

      /**
       * Keep the standing-order mandate id, which every payload has always
       * carried and this handler has always discarded.
       *
       * Grow documents `directDebitId` as "קוד הוראת קבע ולא קוד עסקה" — the
       * MANDATE code, not a transaction code. It is the only identifier that
       * names the subscription rather than a single charge, so without it we
       * cannot later cancel that standing order, reconcile it, or tie a
       * recurring charge back to the subscription its mandate created.
       *
       * WRITTEN HERE, NOT IN performAgencyUpgrade. The upsert is shared with
       * admin grants and trial conversions that have no Grow mandate at all,
       * and it is deliberately a pure period calculation. This is a webhook
       * fact, so it is recorded by the webhook — inside the SAME transaction,
       * so a mandate id can never outlive a rolled-back activation.
       *
       * ABSENT MEANS ABSENT. A payload without a usable mandate id writes
       * nothing, leaving the column NULL rather than inventing a value or
       * overwriting a good id with an empty string.
       */
      const mandateId = readMandateId(payload)
      if (mandateId) {
        await trx('subscriptions').where({ agencyId }).update({ growDirectDebitId: mandateId })
      }
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
