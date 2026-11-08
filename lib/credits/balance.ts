/**
 * Purchased-credit balance: pure arithmetic over ledger totals. Purchased credits
 * do not expire; the free monthly allowance is a request count (agent_requests),
 * not a ledger amount. Amounts are integer milli-credits.
 */

export type LedgerTotal = { periodKey: string; entryType: string; sumMillis: number; count: number }

export type WalletBalance = {
  periodKey: string
  purchasedTotalMillis: number
  /** Credits consumed this month (refunds netted). */
  usedThisPeriodMillis: number
  /** Founder (exempt) operations this month: recorded at zero cost. */
  exemptThisPeriod: number
  availableMillis: number
}

export function computeBalance(totals: readonly LedgerTotal[], periodKey: string): WalletBalance {
  let purchased = 0
  let spent = 0
  let used = 0
  let exempt = 0
  for (const t of totals) {
    const v = Number(t.sumMillis) || 0
    if (t.entryType === 'purchase_grant') purchased += v
    else if (t.entryType === 'debit' || t.entryType === 'refund') {
      spent -= v
      if (t.periodKey === periodKey) used -= v
    } else if (t.entryType === 'exempt_debit' && t.periodKey === periodKey) exempt += Number(t.count) || 0
  }
  return { periodKey, purchasedTotalMillis: purchased, usedThisPeriodMillis: Math.max(0, used), exemptThisPeriod: exempt, availableMillis: purchased - spent }
}

export const MILLIS_PER_CREDIT = 1000
export const toCredits = (millis: number): number => Math.round(millis) / MILLIS_PER_CREDIT

/**
 * Milli-credits for an AI operation's ACTUAL cost. Rounded UP to the next
 * milli-credit, so a priced operation never debits zero; an unpriced one (no
 * provider-reported cost) debits nothing and is flagged by the caller.
 */
export function aiCostToMillis(costUsd: number | null, usdPerCredit: number): number {
  if (costUsd === null || !Number.isFinite(costUsd) || costUsd <= 0) return 0
  return Math.ceil((costUsd / usdPerCredit) * MILLIS_PER_CREDIT - 1e-9)
}
