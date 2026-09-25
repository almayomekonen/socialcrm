import type { GrowEnvelope } from './http'

/**
 * Read getTokenTransactionsByExternalIdentifiers.
 *
 * Grow does not document this response. The shape below was OBSERVED once, on
 * the sandbox account, 2026-09-17, for a charge that had succeeded:
 *
 *   status 1, err null, data.transactions[1] = {
 *     transactionId "549236", transactionToken, statusCode 2 (number),
 *     status "שולם", sum "1", asmachta, paymentType "2", card fields, times
 *   }
 *
 * So exactly one case is established: ONE transaction, statusCode 2, with a
 * transactionId, for the amount we charged. Everything else — an empty array,
 * several transactions, another statusCode, an envelope error — was never
 * observed, and this returns `undetermined` for all of it.
 *
 * An empty result is the important one. It is NOT evidence that no charge was
 * made: it could equally mean not-yet-visible or not-found, and we have no way
 * to tell them apart. Reading it as "not charged" would licence a second charge
 * for a payment that may already exist, which is the one mistake reconciliation
 * exists to prevent.
 */

export type LookupVerdict =
  | { kind: 'paid'; transactionId: string; transactionToken: string | null; asmachta: string | null; statusCode: string }
  | { kind: 'undetermined'; reason: string }

/** statusCode arrives as a number here and as a string from getPaymentProcessInfo. */
const PAID_STATUS_CODE = '2'
const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).trim() || null)

export function interpretTokenLookup(env: GrowEnvelope, expected: { sum: number }): LookupVerdict {
  if (env.status !== 1) return { kind: 'undetermined', reason: `envelope_status_${env.status}` }

  const data = env.data as { transactions?: unknown } | null
  const rows = data?.transactions
  if (!Array.isArray(rows)) return { kind: 'undetermined', reason: 'transactions_not_an_array' }

  // Never "not charged": unobserved, and indistinguishable from not-yet-visible.
  if (rows.length === 0) return { kind: 'undetermined', reason: 'no_transactions_returned' }
  if (rows.length > 1) return { kind: 'undetermined', reason: `multiple_transactions_${rows.length}` }

  const tx = rows[0] as Record<string, unknown>
  const statusCode = asText(tx.statusCode)
  const transactionId = asText(tx.transactionId)
  const sum = asText(tx.sum)

  if (statusCode !== PAID_STATUS_CODE) return { kind: 'undetermined', reason: `unobserved_status_code_${statusCode ?? 'none'}` }
  if (!transactionId) return { kind: 'undetermined', reason: 'paid_without_transaction_id' }
  // Settling a different amount than we asked for would be worse than waiting.
  if (sum === null || Number(sum) !== expected.sum) return { kind: 'undetermined', reason: `sum_mismatch_${sum ?? 'none'}` }

  return {
    kind: 'paid',
    transactionId,
    transactionToken: asText(tx.transactionToken),
    asmachta: asText(tx.asmachta),
    statusCode,
  }
}
