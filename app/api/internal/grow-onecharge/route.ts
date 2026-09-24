import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { assertGrowRuntime, getGrowApiConfig, GROW_SANDBOX_BASE_URL } from '@/lib/payments/grow/config'
import { safeEqual } from '@/lib/payments/grow/constantTime'
import { chargeToken, lookupTokenTransactionsRaw } from '@/lib/payments/grow/api'
import { decryptCardToken, getPaymentMethodById } from '@/db/payments/paymentMethods'
import { CHARGE_DESCRIPTION } from '@/lib/payments/cardTrial/terms'

/**
 * TEMPORARY. One ₪1 sandbox charge, then this file is deleted.
 *
 * Grow asked for a NEW transaction carrying a single identifier, after telling
 * us on 2026-09-17 to send one of transactionUniqueIdentifier /
 * transactionGroupIdentifier rather than both. The correction is already
 * deployed; this exists only to produce the transaction that proves it on the
 * wire, because the card token lives encrypted in the staging database and
 * every credential that could reach it from outside is stored sensitive.
 *
 * WHAT IT WILL NOT DO. No duplicate test. No retry, with this identifier or a
 * new one. No fallback to another card. It charges once or it refuses, and an
 * ambiguous answer ends in a read-only lookup and a stop.
 *
 * NOTHING SECRET LEAVES. The card token, the database URL and the encryption
 * key are used and never returned; the response carries field NAMES and
 * redacted values.
 */

export const maxDuration = 60

const LOG = '[grow-onecharge]'

/** The only card this route may ever touch. */
const AGENCY_ID = 6
const PAYMENT_METHOD_ID = 11
/** The documented test-card save. Card 10 is the owner's personal card and is never eligible. */
const EXPECTED_SETUP_TRANSACTION_ID = '549233'
const SUM_ILS = 1
const ATTEMPT_EVENT = 'grow_onecharge_attempt'
/** One namespace, one key: concurrent invocations serialise here. */
const LOCK_KEY = 917_549_233

type Refusal = { step: string; reason: string }
const refuse = (step: string, reason: string, status = 409) => {
  console.warn(`${LOG} refused`, { step, reason })
  return NextResponse.json({ ok: false, refused: { step, reason } satisfies Refusal }, { status })
}

/** Field names always; values only where they cannot identify a card or a holder. */
const SAFE_FIELDS = new Set(['sum', 'paymentType', 'paymentNum', 'transactionUniqueIdentifier', 'description'])

export async function POST(req: NextRequest) {
  const secret = process.env.GROW_ONECHARGE_SECRET
  if (!secret) return refuse('auth', 'secret_not_configured', 500)
  const offered = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!offered || !safeEqual(offered, secret)) return refuse('auth', 'unauthorized', 403)

  // ENVIRONMENT. Staging + sandbox only, and the provider host is pinned so a
  // mis-set GROW_MODE cannot aim this at the production acquirer.
  let runtime
  try {
    runtime = assertGrowRuntime()
  } catch (err) {
    return refuse('runtime', String(err instanceof Error ? err.message : err))
  }
  if (runtime.env !== 'staging' || runtime.mode !== 'sandbox') return refuse('runtime', `env_mode:${runtime.env}/${runtime.mode}`)
  const { baseUrl } = getGrowApiConfig()
  if (baseUrl !== GROW_SANDBOX_BASE_URL) return refuse('runtime', 'provider_host_not_sandbox')

  // THE CARD. Identity, ownership, mode, liveness, and the binding to the
  // documented test-card save. Any mismatch stops the run.
  const method = await getPaymentMethodById(PAYMENT_METHOD_ID)
  if (!method) return refuse('card', 'payment_method_missing')
  if (method.id !== PAYMENT_METHOD_ID) return refuse('card', 'payment_method_id_mismatch')
  if (method.agencyId !== AGENCY_ID) return refuse('card', 'agency_mismatch')
  if (method.providerMode !== 'sandbox') return refuse('card', `provider_mode:${method.providerMode}`)
  if (method.status !== 'active') return refuse('card', `status:${method.status}`)

  const bound = await db('billing_payment_methods').where({ id: PAYMENT_METHOD_ID }).first('setupTransactionId')
  const setupTransactionId = bound?.setupTransactionId == null ? null : String(bound.setupTransactionId)
  if (setupTransactionId !== EXPECTED_SETUP_TRANSACTION_ID) {
    // The binding is the provenance. Without it this is an unidentified card.
    return refuse('card', `setup_transaction_id:${setupTransactionId ?? 'none'}`)
  }

  let cardToken: string
  try {
    cardToken = decryptCardToken(method)
  } catch {
    return refuse('card', 'card_token_unreadable')
  }
  if (!cardToken) return refuse('card', 'card_token_empty')

  /**
   * DURABLE SINGLE USE. The identifier is written inside a transaction holding
   * an advisory lock, so a second invocation — concurrent or an hour later —
   * finds the row and refuses. It is persisted BEFORE dispatch: if this process
   * dies mid-request the identifier still exists, and the next caller reconciles
   * that one instead of charging again.
   */
  const uniqueIdentifier = Math.floor(Date.now() / 1000)
  const claim = await db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [LOCK_KEY])
    const existing = await trx('analytics_events').where({ agencyId: AGENCY_ID, event: ATTEMPT_EVENT }).first('props')
    if (existing) return { claimed: false as const, priorIdentifier: existing.props?.uniqueIdentifier ?? null }
    await trx.raw(
      `INSERT INTO analytics_events ("agencyId", "userId", event, props) VALUES (?, NULL, ?, ?::jsonb)`,
      [AGENCY_ID, ATTEMPT_EVENT, JSON.stringify({ uniqueIdentifier, paymentMethodId: PAYMENT_METHOD_ID, sum: SUM_ILS, setupTransactionId })],
    )
    return { claimed: true as const, priorIdentifier: null }
  })
  if (!claim.claimed) {
    return refuse('single_use', `already_attempted:${claim.priorIdentifier ?? 'unknown'}`)
  }

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
  try {
    result = await chargeToken({
      cardToken,
      holder: method.holder,
      sum: SUM_ILS,
      description: CHARGE_DESCRIPTION,
      uniqueIdentifier,
    })
  } catch (err) {
    console.error(`${LOG} transport failure — NOT retried`, { uniqueIdentifier, err: String(err) })
    return NextResponse.json(
      { ok: false, uniqueIdentifier, outgoing, outcome: 'transport_failed', detail: String(err instanceof Error ? err.message : err) },
      { status: 502 },
    )
  } finally {
    globalThis.fetch = realFetch
  }

  console.log(`${LOG} dispatched`, { uniqueIdentifier, kind: result.kind })

  // AMBIGUOUS ⇒ one read-only lookup, then stop. Never a second charge.
  if (result.kind !== 'paid') {
    let lookup: unknown = null
    let lookupError: string | null = null
    try {
      lookup = await lookupTokenTransactionsRaw({ cardToken, identifier: { uniqueIdentifier } })
    } catch (err) {
      lookupError = String(err instanceof Error ? err.message : err)
    }
    return NextResponse.json({ ok: false, uniqueIdentifier, outgoing, outcome: result, reconciliation: { lookup, lookupError } })
  }

  return NextResponse.json({ ok: true, uniqueIdentifier, outgoing, outcome: result })
}
