import { getGrowApiConfig } from './config'
import { postGrowForm, type GrowEnvelope } from './http'

/**
 * Grow Light API calls needed for card-token billing, limited to DOCUMENTED
 * behaviour (field names and example responses from Grow's reference pages).
 *
 * NOT ESTABLISHED — Gate B (spec §9) must supply evidence before any caller may
 * rely on these as facts:
 *  - which statusCode a successful token save returns, and whether
 *    getPaymentProcessInfo returns token-only saves with their cardToken;
 *  - what Grow actually does with a repeated transactionUniqueIdentifier or
 *    transactionGroupIdentifier;
 *  - the response shape of getTokenTransactionsByExternalIdentifiers.
 * So nothing here verifies a token, classifies a declined card, or claims
 * idempotency. Never send ApproveTransaction for these flows (Grow: not for
 * save-token-only or token transactions).
 */

export type CardHolder = { fullName: string; phone: string; email: string | null }

export class GrowApiError extends Error {
  constructor(
    public errorId: number | null,
    public errorMessage: string,
  ) {
    super(`grow.api.error:${errorId ?? 'none'}`)
    this.name = 'GrowApiError'
  }
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t ? t : null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function okData(env: GrowEnvelope): Record<string, unknown> {
  if (env.status !== 1) throw new GrowApiError(env.err?.id ?? null, env.err?.message ?? '')
  return isObj(env.data) ? env.data : {}
}

function holderFields(holder: CardHolder): Record<string, string> {
  const fields: Record<string, string> = { 'pageField[fullName]': holder.fullName, 'pageField[phone]': holder.phone }
  if (holder.email) fields['pageField[email]'] = holder.email
  return fields
}

export type CreateTokenProcessInput = {
  holder: CardHolder
  reference: string
  description: string
  successUrl: string
  cancelUrl: string
  /** Empty string omits the field (Grow documents notifyUrl as optional). */
  notifyUrl: string
}

/** Grow "Get Token Only" (create-payment-process-6): chargeType=3, sum "must be 1", saveCardToken=1. */
export async function createTokenOnlyProcess(
  input: CreateTokenProcessInput,
): Promise<{ processId: string; processToken: string; url: string }> {
  const { userId, tokenPageCode } = getGrowApiConfig()
  const fields: Record<string, string | number> = {
    pageCode: tokenPageCode,
    userId,
    chargeType: 3,
    sum: 1,
    saveCardToken: 1,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    description: input.description,
    cField1: input.reference,
    ...holderFields(input.holder),
  }
  if (input.notifyUrl) fields.notifyUrl = input.notifyUrl
  const data = okData(await postGrowForm('createPaymentProcess', fields))
  const processId = s(data.processId)
  const processToken = s(data.processToken)
  const url = s(data.url)
  if (!processId || !processToken || !url) throw new GrowApiError(null, 'create_process_incomplete_response')
  return { processId, processToken, url }
}

export type GrowProcessTransaction = {
  transactionId: string | null
  transactionToken: string | null
  statusCode: string | null
  sum: string | null
  cardToken: string | null
  cardSuffix: string | null
  cardBrand: string | null
  cardExp: string | null
}

/**
 * getPaymentProcessInfo — the documented fields of `data.transactions[]`,
 * uninterpreted. Its only documented example is a PAID transaction; whether a
 * token-only process appears here is Gate B question G3.
 */
export async function getPaymentProcessInfo(input: { processId: string; processToken: string }): Promise<GrowProcessTransaction[]> {
  const { tokenPageCode } = getGrowApiConfig()
  const data = okData(
    await postGrowForm('getPaymentProcessInfo', { pageCode: tokenPageCode, processId: input.processId, processToken: input.processToken }),
  )
  const list = Array.isArray(data.transactions) ? data.transactions.filter(isObj) : []
  return list.map((t) => ({
    transactionId: s(t.transactionId),
    transactionToken: s(t.transactionToken),
    statusCode: s(t.statusCode),
    sum: s(t.sum),
    cardToken: s(t.cardToken),
    cardSuffix: s(t.cardSuffix),
    cardBrand: s(t.cardBrand),
    cardExp: s(t.cardExp),
  }))
}

export type ChargeTokenInput = {
  cardToken: string
  holder: CardHolder
  sum: number
  description: string
  /** Sent as transactionUniqueIdentifier. Grow's real handling of a repeat is unverified (G7). */
  uniqueIdentifier: number
  /** Sent as transactionGroupIdentifier. Grow's real handling of a repeat is unverified (G7). */
  groupIdentifier: number
}

export type TokenChargeResult =
  | { kind: 'paid'; transactionId: string; transactionToken: string | null; asmachta: string | null; statusCode: string }
  /** Grow accepted the request but the answer is not the documented paid shape. The outcome is UNKNOWN. */
  | { kind: 'unrecognized'; statusCode: string | null; transactionId: string | null }
  | { kind: 'grow_error'; errorId: number | null; errorMessage: string }

/**
 * createTransactionWithToken, one regular charge (paymentType 2, paymentNum 1),
 * sent exactly once.
 * - `paid`: statusCode 2 ("paid" in Grow's parameter-mapping table) with a
 *   transactionId — the documented success example.
 * - `unrecognized`: status 1 with any other shape. Undocumented for this call,
 *   so the money outcome is unknown: reconcile, never retry or treat as declined.
 * - `grow_error`: envelope status 0, returned verbatim and NOT classified as a
 *   decline — it may equally be a validation or duplicate-identifier refusal.
 * Transport failures (GrowTransportError) propagate: outcome unknown.
 */
export async function chargeToken(input: ChargeTokenInput): Promise<TokenChargeResult> {
  const { userId } = getGrowApiConfig()
  const env = await postGrowForm('createTransactionWithToken', {
    cardToken: input.cardToken,
    userId,
    sum: input.sum,
    description: input.description,
    paymentType: 2,
    paymentNum: 1,
    transactionUniqueIdentifier: input.uniqueIdentifier,
    transactionGroupIdentifier: input.groupIdentifier,
    ...holderFields(input.holder),
  })
  if (env.status !== 1) return { kind: 'grow_error', errorId: env.err?.id ?? null, errorMessage: env.err?.message ?? '' }
  const data = isObj(env.data) ? env.data : {}
  const statusCode = s(data.statusCode)
  const transactionId = s(data.transactionId)
  if (statusCode === '2' && transactionId) {
    return { kind: 'paid', transactionId, transactionToken: s(data.transactionToken), asmachta: s(data.asmachta), statusCode }
  }
  return { kind: 'unrecognized', statusCode, transactionId }
}

/**
 * getTokenTransactionsByExternalIdentifiers. The request is documented; the
 * RESPONSE IS NOT. This returns Grow's envelope as received so the sandbox probe
 * can record the real shape. Reconciliation logic must not be built on it until
 * Gate B evidence exists.
 */
export async function lookupTokenTransactionsRaw(input: { cardToken: string; uniqueIdentifier: number }): Promise<GrowEnvelope> {
  const { userId } = getGrowApiConfig()
  return postGrowForm('getTokenTransactionsByExternalIdentifiers/', {
    userId,
    cardToken: input.cardToken,
    transactionUniqueIdentifier: input.uniqueIdentifier,
  })
}
