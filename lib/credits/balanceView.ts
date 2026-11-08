import { db } from '@/config/db'
import { freeRequestsUsed, spendableMillis } from '@/db/credits/agentRequests'
import { creditPeriodKey, walletBalance } from '@/db/credits/ledger'
import { listCreditPackCharges, type PackPurchaseRow } from '@/db/credits/purchases'
import { getActivePaymentMethod } from '@/db/payments/paymentMethods'
import { toCredits } from './balance'
import { allPacks, canPurchaseCredits, isCreditEnforcedFor, isCreditsMeteringEnabled, isPackSellable, lowBalancePercent, monthlyAllowance, type PackConfig } from './config'

/** The billing centre's picture of an agency's agent usage. READ ONLY. */

export type CreditBalanceView = {
  periodKey: string
  metering: boolean
  /** Requests are actually limited for this agency (otherwise: measurement only). */
  enforced: boolean
  canPurchase: boolean
  hasCard: boolean
  freeLimit: number
  freeUsed: number
  purchasedAvailable: number
  exemptThisPeriod: number
  state: 'ok' | 'low' | 'exhausted'
  packs: PackConfig[]
  purchases: PackPurchaseRow[]
}

export async function getCreditBalanceView(agencyId: number, nowMs = Date.now()): Promise<CreditBalanceView> {
  const periodKey = creditPeriodKey(nowMs)
  const [agency, balance, spendable, freeUsed, method, purchases] = await Promise.all([
    db('agencies').where({ id: agencyId }).first('plan') as Promise<{ plan: string | null } | undefined>,
    walletBalance(db, agencyId, periodKey),
    spendableMillis(db, agencyId, periodKey),
    freeRequestsUsed(db, agencyId, periodKey),
    getActivePaymentMethod(agencyId),
    listCreditPackCharges(agencyId),
  ])
  const freeLimit = monthlyAllowance()
  const freeLeft = Math.max(0, freeLimit - freeUsed)
  const purchasedAvailable = Math.max(0, toCredits(spendable))
  const state = freeLeft === 0 && purchasedAvailable < 1 ? 'exhausted' : purchasedAvailable < 1 && freeLeft <= Math.floor((freeLimit * lowBalancePercent()) / 100) ? 'low' : 'ok'
  return {
    periodKey,
    metering: isCreditsMeteringEnabled(),
    enforced: isCreditEnforcedFor(agencyId, agency?.plan),
    canPurchase: canPurchaseCredits(agencyId),
    hasCard: !!method,
    freeLimit,
    freeUsed,
    purchasedAvailable,
    exemptThisPeriod: balance.exemptThisPeriod,
    state,
    packs: isPackSellable(agencyId, agency?.plan) ? allPacks() : [],
    purchases,
  }
}
