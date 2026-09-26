import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { assertGrowRuntime, getGrowApiConfig, GROW_PRODUCTION_BASE_URL } from '@/lib/payments/grow/config'
import { safeEqual } from '@/lib/payments/grow/constantTime'
import { chargeToken, lookupTokenTransactionsRaw } from '@/lib/payments/grow/api'
import { interpretTokenLookup } from '@/lib/payments/grow/interpretTokenLookup'
import { decryptCardToken, getPaymentMethodById } from '@/db/payments/paymentMethods'

/**
 * TEMPORARY. One ₪1 PRODUCTION charge, then this file is deleted.
 *
 * tokenChargeDispatch.production and tokenChargeReconciliation.production have
 * never been executed, so they are shut, so no ordinary code path can charge in
 * production — which is also why no ordinary code path can produce the evidence
 * that would open them. This route is the one authorised way out of that
 * circle, exactly as verifyTokenSave's read-only lookup was for the save gate.
 *
 * THIS IS A REAL CAPTURE, NOT A HOLD. The owner's own Mastercard is charged ₪1.
 * The card-save ₪1 was an authorization hold that Grow releases; this is not.
 *
 * WHAT IT WILL NOT DO. No duplicate test. No retry, with this identifier or a
 * new one. No fallback to another card or to a pending setup. No
 * ApproveTransaction. No paid month: it writes nothing to payments,
 * subscriptions, billing_charges, agencies.plan, planReason or the trial dates.
 * It charges once or it refuses, and an ambiguous answer ends in one read-only
 * lookup and a stop.
 *
 * NOTHING SECRET LEAVES. The card token, the database URL and the encryption
 * key are used and never returned; the response carries field NAMES and
 * redacted values.
 */

export const maxDuration = 60

const LOG = '[grow-diagnostic-charge]'

/** The only account and card this route may ever touch. */
const AGENCY_ID = 103
const PAYMENT_METHOD_ID = 4
/** The verified production save of 2026-09-26 — this card's provenance. */
const EXPECTED_SUFFIX = '0675'
const EXPECTED_BRAND = 'Mastercard'
const EXPECTED_SETUP_STATUS_CODE = '11'
const SUM_ILS = 1
/** Letters, digits and spaces only: Grow rejects anything else. Deliberately not
 *  CHARGE_DESCRIPTION, which says "מנוי חודשי" — there is no subscription here. */
const DESCRIPTION = 'SocialCRM diagnostic verification'
const CLAIM_EVENT = 'grow_diagnostic_charge_claim'
const RESULT_EVENT = 'grow_diagnostic_charge_result'
/** One namespace, one key: concurrent invocations serialise here. */
const LOCK_KEY = 926_103_004

const refuse = (step: string, reason: string, status = 409) => {
  console.warn(`${LOG} refused`, { step, reason })
  return NextResponse.json({ ok: false, refused: { step, reason } }, { status })
}

/** Field names always; values only where they cannot identify a card or a holder. */
const SAFE_FIELDS = new Set(['sum', 'paymentType', 'paymentNum', 'transactionUniqueIdentifier', 'description'])

export async function POST(req: NextRequest) {
  const secret = process.env.GROW_DIAGNOSTIC_SECRET
  if (!secret) return refuse('auth', 'secret_not_configured', 500)
  const offered = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!offered || !safeEqual(offered, secret)) return refuse('auth', 'unauthorized', 403)

  // ENVIRONMENT. Production only, and the provider host is pinned so a mis-set
  // GROW_MODE cannot aim this anywhere else.
  let runtime
  try {
    runtime = assertGrowRuntime()
  } catch (err) {
    return refuse('runtime', String(err instanceof Error ? err.message : err))
  }
  if (runtime.env !== 'production' || runtime.mode !== 'production') return refuse('runtime', `env_mode:${runtime.env}/${runtime.mode}`)
  if (getGrowApiConfig().baseUrl !== GROW_PRODUCTION_BASE_URL) return refuse('runtime', 'provider_host_not_production')

  // THE CARD. Identity, ownership, mode, liveness and provenance. Any mismatch
  // stops the run; there is no second candidate to fall back to by design.
  const method = await getPaymentMethodById(PAYMENT_METHOD_ID)
  if (!method) return refuse('card', 'payment_method_missing')
  if (method.id !== PAYMENT_METHOD_ID) return refuse('card', 'payment_method_id_mismatch')
  if (method.agencyId !== AGENCY_ID) return refuse('card', 'agency_mismatch')
  if (method.providerMode !== 'production') return refuse('card', `provider_mode:${method.providerMode}`)
  if (method.status !== 'active') return refuse('card', `status:${method.status}`)

  const bound = await db('billing_payment_methods')
    .where({ id: PAYMENT_METHOD_ID })
    .first('cardSuffix', 'cardBrand', 'setupStatusCode', 'confirmedAt')
  if (!bound?.confirmedAt) return refuse('card', 'not_confirmed')
  if (bound.cardSuffix !== EXPECTED_SUFFIX) return refuse('card', `card_suffix:${bound.cardSuffix ?? 'none'}`)
  if (bound.cardBrand !== EXPECTED_BRAND) return refuse('card', `card_brand:${bound.cardBrand ?? 'none'}`)
  if (String(bound.setupStatusCode) !== EXPECTED_SETUP_STATUS_CODE) return refuse('card', `setup_status_code:${bound.setupStatusCode ?? 'none'}`)

  let cardToken: string
  try {
    cardToken = decryptCardToken(method)
  } catch {
    return refuse('card', 'card_token_unreadable')
  }
  if (!cardToken) return refuse('card', 'card_token_empty')

  /**
   * DURABLE SINGLE USE, CLAIMED BEFORE THE PROVIDER IS CONTACTED.
   *
   * The identifier is written inside a transaction holding an advisory lock, so
   * a second invocation — concurrent, after a timeout, after a crash, or after
   * a redeploy — finds the claim and refuses. It is persisted BEFORE dispatch
   * precisely because a marker written afterwards proves nothing: a request that
   * died in flight may still have charged the card, and the next caller must
   * reconcile that attempt rather than make a new one.
   */
  const uniqueIdentifier = Math.floor(Date.now() / 1000)
  const claim = await db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [LOCK_KEY])
    const existing = await trx('analytics_events').where({ agencyId: AGENCY_ID, event: CLAIM_EVENT }).first('props')
    if (existing) return { claimed: false as const, priorIdentifier: existing.props?.uniqueIdentifier ?? null }
    await trx.raw(`INSERT INTO analytics_events ("agencyId", "userId", event, props) VALUES (?, NULL, ?, ?::jsonb)`, [
      AGENCY_ID,
      CLAIM_EVENT,
      JSON.stringify({ uniqueIdentifier, paymentMethodId: PAYMENT_METHOD_ID, sum: SUM_ILS, cardSuffix: EXPECTED_SUFFIX }),
    ])
    return { claimed: true as const, priorIdentifier: null }
  })
  if (!claim.claimed) return refuse('single_use', `already_attempted:${claim.priorIdentifier ?? 'unknown'}`)

  // EVIDENCE. The genuine outgoing request, captured by wrapping fetch for the
  // duration of this call only, then restored.
  const outgoing: { url: string; fields: Record<string, string> } = { url: '', fields: {} }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('createTransactionWithToken') && init?.body instanceof FormData) {
      outgoing.url = url
      for (const [k, v] of (init.body as FormData).entries()) {
        outgoing.fields[k] = SAFE_FIELDS.has(k) ? String(v) : `<redacted:${String(v).length}>`
      }
    }
    return realFetch(input as RequestInfo, init)
  }) as typeof fetch

  let result
  let transportError: string | null = null
  try {
    result = await chargeToken({ cardToken, holder: method.holder, sum: SUM_ILS, description: DESCRIPTION, uniqueIdentifier })
  } catch (err) {
    // NOT retried. The claim stands, so nothing may charge again; the lookup
    // below is what establishes whether this attempt took the money.
    transportError = String(err instanceof Error ? err.message : err)
    console.error(`${LOG} transport failure — NOT retried`, { uniqueIdentifier, err: transportError })
  } finally {
    globalThis.fetch = realFetch
  }
  console.log(`${LOG} dispatched`, { uniqueIdentifier, kind: result?.kind ?? 'transport_failed' })

  // RECONCILIATION. Read-only, moves no money, and runs on every outcome —
  // including the ambiguous and the failed, which are exactly the cases where
  // the dispatch response cannot be trusted on its own.
  let lookupVerdict: unknown = null
  let lookupRaw: unknown = null
  let lookupError: string | null = null
  try {
    const env = await lookupTokenTransactionsRaw({ cardToken, identifier: { uniqueIdentifier } })
    lookupRaw = env
    lookupVerdict = interpretTokenLookup(env, { sum: SUM_ILS })
  } catch (err) {
    lookupError = String(err instanceof Error ? err.message : err)
  }

  await db.raw(`INSERT INTO analytics_events ("agencyId", "userId", event, props) VALUES (?, NULL, ?, ?::jsonb)`, [
    AGENCY_ID,
    RESULT_EVENT,
    JSON.stringify({
      uniqueIdentifier,
      dispatch: result ? { kind: result.kind, statusCode: 'statusCode' in result ? result.statusCode : null, transactionId: 'transactionId' in result ? result.transactionId : null } : { kind: 'transport_failed' },
      lookup: lookupVerdict,
      lookupError,
    }),
  ])

  return NextResponse.json({
    ok: result?.kind === 'paid',
    uniqueIdentifier,
    outgoing,
    dispatch: result ?? { kind: 'transport_failed', detail: transportError },
    reconciliation: { verdict: lookupVerdict, raw: lookupRaw, error: lookupError },
  })
}
