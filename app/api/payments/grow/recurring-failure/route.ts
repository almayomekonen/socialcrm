import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { assertWebhookEnv, unwrapPayload, verifyWebhookSecret, readMandateId, maskEmail } from '@/lib/payments/growWebhook'

/**
 * Grow webhook option 7 — "Failure recurring payments (Triggered when a
 * recurring charge fails)".
 *
 * THIS ENDPOINT CANNOT GRANT ANYTHING. It never inserts into `payments`, never
 * calls `performAgencyUpgrade`, never touches `subscriptions.expiresAt`,
 * `agencies.plan` or `planReason`. That is not a policy applied at the end — it
 * is the reason the endpoint exists separately at all.
 *
 * WHY A DEDICATED URL RATHER THAN A BRANCH IN THE TRANSACTION HANDLER. Option
 * 7's payload is a different schema in a different case convention:
 *
 *   regular_payment_id, payer_name, phone, email, transaction_type,
 *   card_suffix, sum, description, business_title, error_message,
 *   charges_attempts, webhook_key
 *
 * It carries NO `err`, NO `status`, NO `statusCode` — the only fields
 * `classifyPaymentOutcome` reads. Routed through the transaction handler a
 * FAILED charge would classify `unverifiable`, indistinguishable from a
 * successful one, and on the recurring-initial path that means GRANT. Giving
 * failure its own endpoint removes the possibility structurally rather than
 * relying on a classifier to notice a schema it was never taught.
 *
 * IT ALSO DOES NOT REVOKE. A failed renewal says nothing about the period the
 * customer has already paid for. Access continues to expire naturally at
 * `expiresAt`; ending it early would take away time that was bought.
 *
 * WHAT IT DELIBERATELY DOES NOT CONCLUDE. Grow documents neither retry
 * behaviour nor the meaning of `charges_attempts`, and a failure is not a
 * cancellation. So this records the event and says so loudly; it draws no
 * inference about what Grow will do next.
 */

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') || ''

  // 1. Environment guard — identical to the transaction webhook.
  let envInfo: ReturnType<typeof assertWebhookEnv>
  try {
    envInfo = assertWebhookEnv(host)
  } catch (err) {
    console.error('[GrowRecurringFailure] env guard tripped', { err: String(err) })
    return new NextResponse('Webhook misconfigured', { status: 500 })
  }
  if (envInfo.env !== 'production') {
    console.warn('[GrowRecurringFailure] blocked outside production')
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
  console.log('[GrowRecurringFailure] payload keys:', Object.keys(payload))

  // 3. Authenticate against this endpoint's OWN secret — Grow issues a
  //    separate key per webhook subscription. Same constant-time compare;
  //    option 7's documented `webhook_key` spelling is handled in the helper.
  const auth = verifyWebhookSecret(payload, 'GROW_RECURRING_FAILURE_WEBHOOK_SECRET')
  if (auth.ok === false) {
    if (auth.reason === 'not_configured') {
      console.error('[GrowRecurringFailure] GROW_RECURRING_FAILURE_WEBHOOK_SECRET is not set — refusing to process')
      return new NextResponse('Server misconfigured', { status: 500 })
    }
    console.warn('[GrowRecurringFailure] rejected: missing or invalid webhook key')
    return new NextResponse('Unauthorized', { status: 401 })
  }

  /**
   * 4. Identify the affected subscription, if we can do it deterministically.
   *
   * `regular_payment_id` is the MANDATE code. It matches
   * `subscriptions.growDirectDebitId`, which is only populated for
   * subscriptions activated after that column shipped — older rows have NULL
   * and simply will not match. A miss is reported, never guessed at: there is
   * no email or phone fallback here, because nothing downstream grants
   * anything and a wrong attribution would only produce a misleading alert.
   */
  const mandateId = readMandateId(payload)
  let agencyId: number | null = null
  if (mandateId) {
    const rows = await db('subscriptions').where({ growDirectDebitId: mandateId }).select('agencyId')
    // Exactly one, or nothing. A mandate mapping to several agencies is a data
    // problem to surface, not a subscription to pick.
    if (rows.length === 1) agencyId = rows[0].agencyId
    else if (rows.length > 1) {
      console.error('[GrowRecurringFailure] mandate matches multiple subscriptions', { candidates: rows.length })
    }
  }

  /**
   * 5. Record and alert. No mutation of any billing or entitlement table.
   *
   * `error_message` and `charges_attempts` are logged verbatim because they are
   * Grow's own description of the failure and carry no personal data. The
   * payer's email is masked; the name, phone and card suffix are never logged.
   */
  console.error('[GrowRecurringFailure] recurring charge failed', {
    agencyId,
    mandateResolved: Boolean(agencyId),
    mandatePresent: Boolean(mandateId),
    errorMessage: typeof payload.error_message === 'string' ? payload.error_message : null,
    chargesAttempts: payload.charges_attempts ?? null,
    payerEmail: maskEmail(payload.email ?? payload.payerEmail),
  })

  /**
   * 200 regardless of whether we resolved the subscription. The delivery was
   * authentic and we have consumed it; asking Grow to retry would not teach us
   * anything new, and a 4xx here would look like a rejected notification rather
   * than an unmatched one. Entitlement is untouched either way.
   */
  return NextResponse.json({ ok: true, granted: false, reason: 'recurring_failure', matched: Boolean(agencyId) })
}
