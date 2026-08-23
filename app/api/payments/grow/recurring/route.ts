import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import { resolveBillingPeriod, logPeriodResolution, type PeriodResolution } from '@/lib/payments/resolvePeriod'
import { assertWebhookEnv, unwrapPayload, verifyWebhookSecret, readMandateId, maskEmail } from '@/lib/payments/growWebhook'

const PG_UNIQUE_VIOLATION = '23505'

/**
 * Grow webhook option 6 — "Recurring payment", triggered for recurring charges
 * STARTING FROM THE SECOND CHARGE. This is the renewal path: without it a
 * standing order keeps charging the customer while `expiresAt` never moves and
 * access lapses mid-subscription.
 *
 * WHY A DEDICATED ENDPOINT RATHER THAN A BRANCH IN THE TRANSACTION HANDLER.
 * Option 6's payload is a different schema. Its documented field list is:
 *
 *   webhookKey, transactionCode, transactionType, paymentSum, paymentsNum,
 *   allPaymentNum, firstPaymentSum, periodicalPaymentSum, paymentType,
 *   paymentDate, asmachta, paymentDesc, fullName, payerPhone, payerEmail,
 *   cardSuffix, cardBrand, cardType, paymentSource, directDebitId
 *
 * There is NO `status`, NO `statusCode`, NO `err` — the only fields
 * `classifyPaymentOutcome` reads. Through the transaction handler every
 * renewal would classify `unverifiable`, and the sequence guard exists
 * precisely to refuse an unproven later charge, so renewals would be rejected
 * as a class. Separating the endpoint lets sequence be `subsequent` BY
 * CONSTRUCTION — it is not inferred from a payload that cannot express it.
 *
 * WHY ARRIVAL HERE IS TREATED AS SUCCESS. Grow routes FAILED recurring charges
 * to a different subscription (option 7, `/recurring-failure`), which grants
 * nothing. Option 6 is documented as the success feed. That is a documented
 * premise, not an observed one — see the endpoint's report — and it is the
 * reason option 6 must never be enabled without option 7 also enabled.
 *
 * THE IDENTIFIER RULES, WHICH ARE THE WHOLE POINT:
 *
 *   directDebitId    the MANDATE — "קוד הוראת קבע ולא קוד עסקה", the standing
 *                    order, explicitly NOT a transaction code. It is IDENTICAL
 *                    on every charge of the subscription. Using it as the
 *                    idempotency key would make charge #3 look like a duplicate
 *                    of charge #2 and silently stop extending access. It is
 *                    used ONLY to find the subscription.
 *   transactionCode  the per-charge id, different every renewal. THIS is the
 *                    idempotency key written to `payments.transactionId`.
 *
 * FAIL CLOSED. A charge whose subscription cannot be identified UNIQUELY grants
 * nothing. Guessing an owner here would extend a stranger's paid access on
 * someone else's money.
 */

/**
 * The per-charge identifier, from the one documented field that carries it.
 *
 * Deliberately does NOT fall back to `transactionId`: that field belongs to the
 * PaymentLinks schema and is not documented for option 6. Reading it would be
 * assuming a field Grow has not promised, and a wrong idempotency key is the
 * one mistake this endpoint cannot recover from.
 */
function readTransactionCode(payload: any): string | null {
  const raw = payload?.transactionCode
  if (raw == null) return null
  const s = String(raw).trim()
  return s ? s : null
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') || ''

  // 1. Environment guard — identical to the other Grow endpoints.
  let envInfo: ReturnType<typeof assertWebhookEnv>
  try {
    envInfo = assertWebhookEnv(host)
  } catch (err) {
    console.error('[GrowRecurring] env guard tripped', { err: String(err) })
    return new NextResponse('Webhook misconfigured', { status: 500 })
  }
  if (envInfo.env !== 'production') {
    console.warn('[GrowRecurring] blocked outside production')
    return new Response('Webhook disabled', { status: 400 })
  }

  // 2. Parse.
  const raw = await req.text()
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }
  const payload = unwrapPayload(body)
  if (!payload || typeof payload !== 'object') {
    return new NextResponse('Invalid JSON', { status: 400 })
  }
  console.log('[GrowRecurring] payload keys:', Object.keys(payload))

  // 3. Authenticate BEFORE any business logic or DB access. Its OWN secret —
  //    Grow generates a separate key per webhook subscription, and the
  //    transaction webhook's key must never open this endpoint, which grants
  //    paid time. Same constant-time compare as everywhere else.
  const auth = verifyWebhookSecret(payload, 'GROW_RECURRING_WEBHOOK_SECRET')
  if (auth.ok === false) {
    if (auth.reason === 'not_configured') {
      console.error('[GrowRecurring] GROW_RECURRING_WEBHOOK_SECRET is not set — refusing to process')
      return new NextResponse('Server misconfigured', { status: 500 })
    }
    console.warn('[GrowRecurring] rejected: missing or invalid webhookKey')
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 4. The two identifiers, kept strictly apart.
  const transactionCode = readTransactionCode(payload)
  const mandateId = readMandateId(payload)

  if (!transactionCode) {
    console.error('[GrowRecurring] no transactionCode — cannot make this charge idempotent, refusing', {
      mandatePresent: Boolean(mandateId),
      payerEmail: maskEmail(payload.payerEmail ?? payload.email),
    })
    return NextResponse.json({ ok: true, granted: false, reason: 'missing_transaction_code' })
  }

  /**
   * Defence against the exact failure this endpoint exists to prevent. If a
   * payload ever carried the same value in both fields, using it as the
   * idempotency key would swallow every later renewal as a duplicate and stop
   * extending access silently. Refuse rather than corrupt the ledger.
   */
  if (mandateId && transactionCode === mandateId) {
    console.error('[GrowRecurring] transactionCode equals the mandate id — refusing to use a mandate as an idempotency key')
    return NextResponse.json({ ok: true, granted: false, reason: 'ambiguous_identifiers' })
  }

  if (!mandateId) {
    console.error('[GrowRecurring] no mandate id on a recurring charge — cannot identify the subscription', {
      transactionCode,
      payerEmail: maskEmail(payload.payerEmail ?? payload.email),
    })
    return NextResponse.json({ ok: true, granted: false, reason: 'missing_mandate' })
  }

  /**
   * 5. Identify the subscription — strictly by mandate, exactly one match.
   *
   * No email or phone fallback. The transaction webhook has those because an
   * INITIAL payment must find its owner or the customer gets nothing for money
   * already taken. Here the subscription provably already exists; if its
   * mandate is not on file, that is a reconciliation problem to fix at the
   * source, not to paper over by guessing. A wrong guess extends the wrong
   * agency's access.
   *
   * A NULL mandate never matches: rows that predate mandate capture simply do
   * not resolve, which is the honest outcome — we genuinely do not know.
   */
  const rows = await db('subscriptions').where({ growDirectDebitId: mandateId }).select('agencyId')

  if (rows.length !== 1) {
    console.error('[GrowRecurring] RENEWAL NOT APPLIED — subscription not uniquely identified', {
      transactionCode,
      candidates: rows.length,
      reason: rows.length === 0 ? 'no_subscription_for_mandate' : 'ambiguous_mandate',
      payerEmail: maskEmail(payload.payerEmail ?? payload.email),
      note: 'customer was charged; access was NOT extended; reconcile manually',
    })
    return NextResponse.json({
      ok: true,
      granted: false,
      reason: rows.length === 0 ? 'no_subscription_for_mandate' : 'ambiguous_mandate',
    })
  }

  const agencyId: number = rows[0].agencyId
  console.log('[GrowRecurring] subscription resolved by mandate', { agencyId, transactionCode })

  /**
   * 6. Billing period — ONLY ever the subscription's own.
   *
   * A renewal extends a subscription that already exists, so its period is a
   * fact on the row, never something to infer from the charge.
   *
   * WHY NOT JUST THE RESOLVER'S ANSWER. The resolver's rule 4 is "renewals keep
   * their current period", but it sits BELOW `pending_upgrade` in the chain, and
   * an abandoned upgrade click leaves a `pending` row behind indefinitely —
   * production currently has six of them. Taking the resolver's top answer would
   * let a click someone never paid for decide how much time a real charge buys.
   *
   * So the resolver still runs, for its observability and its candidate set, but
   * only `existing_subscription` is allowed to decide. Reading the candidate
   * rather than the verdict is what makes "a stale intent cannot set the renewal
   * period" true by construction instead of true by luck.
   *
   * Nothing about the initial-payment path changes — there the full chain is
   * correct, because there is no subscription to read from yet.
   */
  let resolution: PeriodResolution = {
    period: 'monthly',
    resolvedBy: 'fallback',
    candidates: { payment_link_id: null, amount: null, pending_upgrade: null, existing_subscription: null },
  }
  try {
    resolution = await resolveBillingPeriod(agencyId, payload)
  } catch (err) {
    console.error('[GrowRecurring] period resolution crashed', {
      agencyId,
      transactionCode,
      err: String(err),
    })
  }
  try {
    logPeriodResolution({ agencyId, transactionId: transactionCode, payload }, resolution)
  } catch {}

  const period = resolution.candidates.existing_subscription
  if (!period) {
    /**
     * No period on the row means we do not know what this charge bought.
     * Guessing monthly would under-extend an annual subscriber by eleven
     * months; guessing annual would give away eleven. Refuse and say so.
     *
     * Only reachable if a mandate is attached to a row that never went through
     * `performAgencyUpgrade` — in practice, a manual backfill onto a legacy
     * row. Check `billingPeriod` before backfilling and this never fires.
     */
    console.error('[GrowRecurring] RENEWAL NOT APPLIED — subscription has no billingPeriod on file', {
      agencyId,
      transactionCode,
      note: 'customer was charged; access was NOT extended; set billingPeriod and reconcile manually',
    })
    return NextResponse.json({ ok: true, granted: false, reason: 'no_billing_period' })
  }
  if (period !== resolution.period) {
    console.log('[GrowRecurring] renewal keeps the subscription period', {
      agencyId,
      transactionCode,
      resolverChose: resolution.period,
      resolverChoseBy: resolution.resolvedBy,
      renewalUses: period,
    })
  }

  /**
   * 7. Extend, atomically and idempotently.
   *
   * The `payments` insert comes FIRST inside the transaction: `transactionId`
   * is UNIQUE, so a redelivered webhook violates it and rolls the whole
   * transaction back before `performAgencyUpgrade` can extend anything. That is
   * the same ordering the initial-payment path relies on.
   *
   * `performAgencyUpgrade` computes `GREATEST(now(), expiresAt) + period` inside
   * the upsert, so an early renewal preserves unused paid time instead of
   * truncating it.
   *
   * The mandate is NOT rewritten here — it is what we searched by, so it is
   * already correct on the row.
   */
  try {
    await db.transaction(async (trx) => {
      await trx('payments').insert({ transactionId: transactionCode, agencyId })
      const result = await performAgencyUpgrade(agencyId, `grow:${transactionCode}`, trx, period)
      if ('error' in result) throw new Error(`upgrade_failed:${result.error}`)
    })
  } catch (err: any) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      console.log('[GrowRecurring] duplicate delivery ignored', { agencyId, transactionCode })
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[GrowRecurring] renewal failed', { agencyId, transactionCode, err: String(err) })
    return new NextResponse('Processing error', { status: 500 })
  }

  console.log('[GrowRecurring] renewal applied', { agencyId, transactionCode, period })

  // Post-commit: analytics must never roll back a payment. track() never throws.
  await track({
    agencyId,
    event: 'subscription_activated',
    props: { transactionId: transactionCode, period, periodResolvedBy: resolution.resolvedBy, renewal: true },
  })

  return NextResponse.json({ ok: true, granted: true, renewal: true, period })
}
