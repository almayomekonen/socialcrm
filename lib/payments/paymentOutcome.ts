/**
 * Did this Grow webhook represent a payment that ACTUALLY SUCCEEDED?
 *
 * WHY THIS EXISTS. The webhook granted a full billing period to any
 * authenticated payload carrying a fresh transaction id — it never inspected a
 * status field at all. That is harmless while Grow only delivers successful
 * one-time transactions, and becomes a real hole the moment "ריצות הוראת קבע"
 * is enabled: a FAILED standing-order run would grant a paid month.
 *
 * WHY THIS IS NOT A STRICT "status must equal success" CHECK.
 *
 * It used to be exactly that, and it caused a production outage. The regression
 * test in `payments-webhook-route.test.ts` records it verbatim: "previously the
 * handler short-circuited any payload whose `status` field didn't equal the
 * literal 'success'. Real PaymentLinks payloads have `status: 'שולם'` or no
 * English status, which used to silently drop every real webhook."
 *
 * The docs-verbatim PaymentLinks payload is:
 *
 *   { err: '', status: '1', data: { status: 'שולם', statusCode: '2', … } }
 *
 * The envelope `status`/`err` describe the REQUEST; `data.statusCode` describes
 * the PAYMENT. `'2'` (שולם) is the only success code the documentation shows, so
 * it is the only value treated as proof here. Nothing else is invented: Grow's
 * failure codes are not documented in this repo, so this module never claims to
 * know them — it only knows what "paid" looks like.
 *
 * THE THREE OUTCOMES, and why the middle one is not simply "deny":
 *
 *   success       a documented paid marker is present → grant
 *   not_success   a status IS present and it is not the paid marker, or the
 *                 envelope carries an error → NEVER grant
 *   unverifiable  no usable status at all. Today's real, working, successful
 *                 PaymentLinks webhooks land here, which is why this cannot be
 *                 a blanket deny without re-breaking live billing.
 *
 * `unverifiable` is resolved by the CALLER, on one axis: a recurring run is
 * fail-closed, a one-time payment keeps today's behaviour. A standing-order run
 * is a brand-new surface with no proven payload, so it must prove success; the
 * one-time path is proven in production and must not regress. That asymmetry is
 * the whole point — it closes the hole that is about to open without reopening
 * the one that was already closed.
 *
 * ORDER OF EVALUATION IS LOAD BEARING, and it was wrong.
 *
 * Matching is by SUBSTRING, and success was tested first. Every negated form of
 * a success word therefore classified as a PAID charge: `'לא שולם'` contains
 * `'שולם'`, `'unpaid'` and `'not paid'` contain `'paid'`, `'not approved'`
 * contains `'approved'`. An explicitly unpaid payload granted a billing period.
 * Failure is now tested BEFORE success, and the negated forms are listed
 * explicitly among the failure words so the substring test resolves them
 * correctly.
 *
 * The negation is handled by an EXPLICIT LIST rather than by detecting a
 * negation prefix near a success word. A prefix heuristic reads far better than
 * it behaves: `'un'` is a substring of `'account'`, so `'account paid'` would be
 * read as unpaid and a real payment would be refused. Wrongly refusing a real
 * payment is the outage this module already carries a warning about, so the
 * cheap clever version is not worth its downside — an unrecognised word still
 * falls to `unverifiable`, never to `success`.
 *
 * PENDING IS A FOURTH OUTCOME, not a shade of unverifiable. `'pending'` /
 * `'ממתין'` carries real information: the charge exists and has not succeeded
 * YET. It used to fall through to `unverifiable`, which on the one-time path
 * means GRANT — so an unfinished payment bought a billing period. It is now
 * refused in its own right, and the caller refuses it on every path.
 *
 * Refusing a pending charge costs nothing later: the caller refuses BEFORE the
 * `payments` row is written, so the transaction id stays unused and a genuine
 * success webhook for that same charge still grants normally.
 */

/** The only payment status code the Grow documentation shows for a paid charge. */
const GROW_PAID_STATUS_CODE = '2'

/** Success words seen in real payloads / repo fixtures. Additive, never exclusive. */
const SUCCESS_WORDS = ['שולם', 'success', 'approved', 'paid']

/**
 * Explicit failure words. Deliberately short: this list exists so an obviously
 * failed payload is denied even when it carries no statusCode. It is NOT a
 * claim to know Grow's full failure vocabulary — anything unrecognised falls to
 * `unverifiable`, never to `success`.
 *
 * The negated forms at the end exist because matching is by substring: each of
 * them CONTAINS a success word, so they must be recognised as failures first or
 * they read as payment. See the header.
 */
const FAILURE_WORDS = [
  'נדחה',
  'בוטל',
  'failed',
  'failure',
  'declined',
  'rejected',
  'error',
  'cancelled',
  'canceled',
  // Negated success words. Order-sensitive: tested before SUCCESS_WORDS.
  'לא שולם',
  'לא אושר',
  'unpaid',
  'not paid',
  'not approved',
  'not successful',
]

/**
 * The charge exists and has not succeeded yet. Distinct from a failure — it may
 * still succeed, under this same transaction id — but it is emphatically not
 * proof of payment, and it must never grant.
 */
const PENDING_WORDS = ['pending', 'ממתין', 'awaiting', 'in process', 'processing', 'initial']

export type PaymentOutcome = 'success' | 'not_success' | 'pending' | 'unverifiable'

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/**
 * Values that mean "this field is present but holds no identifier".
 *
 * PROVEN NECESSARY BY A REAL PAYMENT. Transaction `GvNe/kVpyRfBqOuIks4kXA==`
 * was a one-time Payment Link charge, and its payload still contained
 * `directDebitId` — alongside `periodicalPaymentSum`, `paymentsNum`,
 * `allPaymentNum` and `firstPaymentSum`. Grow emits its FULL PaymentLinks
 * envelope on every transaction and fills the inapplicable fields with
 * placeholders, so the presence of a key says nothing at all about recurrence.
 *
 * The list is deliberately conservative: only values that cannot be a real Grow
 * identifier. That keeps the failure mode safe. If Grow ever uses a placeholder
 * spelling not listed here, the payload is still read as recurring and the
 * charge is still REFUSED — unfixed, never wrongly granted. Widening this list
 * is the direction that could hand a grant to a failed standing order, so it
 * must never grow to cover anything that might be a genuine id.
 */
function hasRecurringIdentifier(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (s === '' || s === '0' || s === 'null' || s === 'undefined' || s === 'false' || s === '-1') return false
  return true
}

/**
 * Does this payload look like a standing-order (הוראת קבע) run rather than a
 * one-time payment? Keyed on the recurring identifiers Grow's webhook docs list
 * — `directDebitId` on a recurring charge, `regular_payment_id` on a failed one.
 *
 * IT IS THE VALUE THAT CARRIES THE SIGNAL, NOT THE KEY.
 *
 * This used to return true whenever one of these keys existed with any non-null
 * value. That refused a real customer's successful one-time payment: the charge
 * classified as `unverifiable` (Grow's PaymentLinks payload carries no status
 * field at all, which is exactly why the one-time path is permissive) and then
 * the presence of a placeholder `directDebitId` flipped it to `recurring`, so
 * the `unverifiable && recurring` rule denied a payment that had been taken.
 *
 * Read-only classification. This phase stores none of these fields.
 */
export function isRecurringRun(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload || typeof payload !== 'object') return false
  return ['directDebitId', 'direct_debit_id', 'regular_payment_id', 'regularPaymentId', 'recurringDebitId'].some(
    (k) => hasRecurringIdentifier((payload as Record<string, unknown>)[k]),
  )
}

/**
 * @param envelope the raw parsed body (carries `err` on the PaymentLinks shape)
 * @param payload  the unwrapped `body.data ?? body` the handler already computes
 */
export function classifyPaymentOutcome(
  envelope: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): PaymentOutcome {
  // Request-level error reported by Grow — never a paid charge.
  const err = envelope && typeof envelope === 'object' ? (envelope as Record<string, unknown>).err : undefined
  if (typeof err === 'string' && err.trim() !== '') return 'not_success'

  const p = (payload ?? {}) as Record<string, unknown>

  // statusCode is the machine-readable payment result and outranks the word.
  const statusCodeRaw = p.statusCode ?? p.status_code
  if (statusCodeRaw != null && String(statusCodeRaw).trim() !== '') {
    return String(statusCodeRaw).trim() === GROW_PAID_STATUS_CODE ? 'success' : 'not_success'
  }

  const status = text(p.status) || text(p.paymentStatus) || text(p.payment_status)
  if (status) {
    // FAILURE FIRST. Every negated success word contains a success word, so
    // testing success first classified 'לא שולם' / 'unpaid' as paid.
    if (FAILURE_WORDS.some((w) => status.includes(w))) return 'not_success'
    if (PENDING_WORDS.some((w) => status.includes(w))) return 'pending'
    if (SUCCESS_WORDS.some((w) => status.includes(w))) return 'success'
  }

  // No usable signal. Real successful PaymentLinks webhooks land here.
  return 'unverifiable'
}
