import { randomUUID } from 'crypto'
import { areSubscriptionChargesEnabled, assertGrowRuntime } from '@/lib/payments/grow/config'
import { isTokenChargeDispatchEstablished } from '@/lib/payments/grow/providerEvidence'
import { claimDueCharges, reclaimStaleInFlightCharges } from '@/db/payments/charges'
import { scheduleDueRenewals, scheduleDueTrialConversions } from '@/db/payments/chargeScheduling'
import { executeCharge, type ExecuteOutcome } from './executeCharge'
import { reconcileUnknownCharges, type ReconcileSummary } from './reconcileUnknown'

/**
 * One scheduler pass: recover expired leases, reconcile unknown outcomes,
 * persist due attempts, then — only when dispatch is established — execute
 * charges ONE AT A TIME until the time budget is spent (claiming one at a time
 * means nothing is claimed and then abandoned by the budget).
 *
 * SUBSCRIPTION_CHARGES_ENABLED absent ⇒ returns before touching the database.
 */

export type ChargePassSummary = {
  enabled: boolean
  dispatch: boolean
  recovered: { requeued: number; unknown: number }
  reconciled: ReconcileSummary
  scheduled: { conversions: number; renewals: number }
  executed: Partial<Record<ExecuteOutcome, number>>
}

export type PassDeps = {
  execute: (chargeId: number) => Promise<ExecuteOutcome>
  reconcile: (limit: number) => Promise<ReconcileSummary>
  dispatchAllowed: () => boolean
  clock: () => number
}

/** A lease longer than one Grow call (15 s timeout) plus settlement. */
export const IN_FLIGHT_LEASE_MS = 10 * 60_000
/** The cron route's maxDuration is 60 s. */
const PASS_BUDGET_MS = 40_000
const SCHEDULE_BATCH = 50
const RECONCILE_BATCH = 10

const liveDeps: PassDeps = {
  execute: (chargeId) => executeCharge(chargeId),
  reconcile: (limit) => reconcileUnknownCharges(limit),
  dispatchAllowed: () => {
    try {
      return isTokenChargeDispatchEstablished(assertGrowRuntime().mode)
    } catch {
      return false
    }
  },
  clock: () => Date.now(),
}

export async function runChargePass(deps: PassDeps = liveDeps): Promise<ChargePassSummary> {
  const summary: ChargePassSummary = {
    enabled: false,
    dispatch: false,
    recovered: { requeued: 0, unknown: 0 },
    reconciled: { paid: 0, notCharged: 0, undetermined: 0 },
    scheduled: { conversions: 0, renewals: 0 },
    executed: {},
  }
  if (!areSubscriptionChargesEnabled()) return summary
  assertGrowRuntime()
  summary.enabled = true

  const startedAt = deps.clock()
  summary.recovered = await reclaimStaleInFlightCharges(IN_FLIGHT_LEASE_MS)
  summary.reconciled = await deps.reconcile(RECONCILE_BATCH)
  summary.scheduled = {
    conversions: await scheduleDueTrialConversions(SCHEDULE_BATCH),
    renewals: await scheduleDueRenewals(SCHEDULE_BATCH),
  }

  summary.dispatch = deps.dispatchAllowed()
  if (!summary.dispatch) return summary

  const workerId = `cron:${randomUUID()}`
  while (deps.clock() - startedAt < PASS_BUDGET_MS) {
    const [charge] = await claimDueCharges(workerId, 1)
    if (!charge) break
    const outcome = await deps.execute(charge.id)
    summary.executed[outcome] = (summary.executed[outcome] ?? 0) + 1
  }
  return summary
}
