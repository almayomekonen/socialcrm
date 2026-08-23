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
 * IS THIS CHARGE PART OF A STANDING ORDER — and if so, which charge?
 *
 * These two questions used to be one, answered by the presence of
 * `directDebitId`, and that conflation caused a production billing outage.
 *
 * WHAT GROW ACTUALLY DOCUMENTS (developers.grow.business/docs/overview-7):
 *
 *   directDebitId  "קוד הוראת קבע ולא קוד עסקה" — the standing-order MANDATE
 *                  code, explicitly NOT a transaction code. A charge that
 *                  CREATES a mandate carries it just as a later charge against
 *                  that mandate does, so it says nothing about which charge
 *                  this is.
 *   paymentType    documented enum: 'רגיל' | 'הוראת קבע' | 'תשלומים'.
 *                  THIS is the discriminator for payment mode.
 *   webhook types  a dedicated "Recurring payment" subscription is
 *                  "Triggered for recurring payments starting from the second
 *                  charge", and a separate "Failure recurring payments"
 *                  subscription fires when a recurring charge fails. Both are
 *                  DIFFERENT SUBSCRIPTIONS from the transaction webhook this
 *                  route is registered as.
 *
 * WHAT WENT WRONG. Transaction `GvNe/kVpyRfBqOuIks4kXA==` was the INITIAL ₪1
 * charge of a monthly הוראת קבע subscription — confirmed by Grow's merchant
 * record ("הו\"ק / 1", source עמוד קבוע). It legitimately carried a
 * `directDebitId`, because it established the mandate. The old check read that
 * as "this is a recurring run", the `unverifiable && recurring` rule refused it,
 * and no subscription could activate at all: the initial charge is the only
 * activation path, and this payload format carries no status field.
 *
 * The sequence axis exists so the guard keeps protecting what it was written
 * for — an unproven LATER charge — without blocking the first one.
 */
const GROW_PAYMENT_TYPE_RECURRING = 'הוראת קבע'
const GROW_PAYMENT_TYPE_ONE_TIME = ['רגיל', 'תשלומים']

/** Mandate identifiers. Evidence of a standing order, never of WHICH charge. */
const MANDATE_ID_FIELDS = ['directDebitId', 'direct_debit_id', 'regular_payment_id', 'regularPaymentId', 'recurringDebitId']

export type PaymentMode = 'one_time' | 'recurring'
export type PaymentSequence = 'initial' | 'subsequent' | 'unknown'

function hasMandateId(payload: Record<string, unknown>): boolean {
  return MANDATE_ID_FIELDS.some((k) => {
    const v = payload[k]
    if (v == null) return false
    if (typeof v === 'boolean') return v
    const s = String(v).trim().toLowerCase()
    return s !== '' && s !== '0' && s !== 'null' && s !== 'undefined' && s !== 'false' && s !== '-1'
  })
}

/**
 * One-time or standing order, from the documented `paymentType` enum.
 *
 * An unrecognised or absent `paymentType` resolves to `one_time`, which
 * preserves the behaviour that is correct in production today: real Payment
 * Links webhooks have always been permitted through the unverifiable path. The
 * sequence classifier below is what refuses when that guess would be unsafe.
 */
export function classifyPaymentMode(payload: Record<string, unknown> | null | undefined): PaymentMode {
  if (!payload || typeof payload !== 'object') return 'one_time'
  const t = text((payload as Record<string, unknown>).paymentType)
  if (t === GROW_PAYMENT_TYPE_RECURRING) return 'recurring'
  if (GROW_PAYMENT_TYPE_ONE_TIME.includes(t)) return 'one_time'
  return 'one_time'
}

/**
 * Which charge of the standing order is this?
 *
 * `initial` — a recurring charge arriving on THIS webhook. Grow delivers charge
 *   #2 onward through a separate "Recurring payment" subscription, so a
 *   standing-order charge reaching the transaction webhook is the one that
 *   opened the mandate.
 *
 * `unknown` — a mandate id is present but `paymentType` did not identify the
 *   mode. The payload is talking about a standing order in a shape we cannot
 *   read, so we decline to guess. FAIL CLOSED: the caller refuses.
 *
 * `subsequent` is reserved for a payload that positively identifies itself as a
 * later execution. Grow documents no such field on this webhook, so nothing
 * returns it today — it exists so the decision table is total, and so that
 * pointing the "Recurring payment" subscription at this route later has an
 * obvious place to be handled rather than silently granting.
 */
export function classifyPaymentSequence(
  payload: Record<string, unknown> | null | undefined,
  mode: PaymentMode,
): PaymentSequence {
  if (!payload || typeof payload !== 'object') return 'initial'
  const p = payload as Record<string, unknown>
  if (mode === 'recurring') return 'initial'
  // one_time by mode, but a mandate id says otherwise and paymentType was not
  // one of the documented values — ambiguous, so refuse rather than guess.
  if (hasMandateId(p) && !GROW_PAYMENT_TYPE_ONE_TIME.includes(text(p.paymentType))) return 'unknown'
  return 'initial'
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
