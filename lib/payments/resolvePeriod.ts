import { db } from '@/config/db'
import { PRICING, type BillingPeriod } from '@/lib/pricing'
import { getConfiguredLinkPeriodIds } from './link'

/**
 * Billing-period classification for Grow webhook charges. Five rules, first
 * hit wins; every rule ABSTAINS (null) rather than guesses, so a rule can
 * never misclassify — only fall through:
 *
 *   1. payment_link_id        paymentLinkProcessId/processId matches an id
 *                             decoded from the configured link URLs
 *   2. amount                 sum exactly equals a known price (89/588)
 *   3. pending_upgrade        fresh intent recorded at upgrade-click
 *   4. existing_subscription  renewals keep their current period
 *   5. fallback               monthly + loud log (never fail the payment)
 *
 * Owner decision (2026-06-12): once production proves paymentLinkProcessId
 * stable per link, rule 1 is permanently the source of truth and amount is
 * a safety fallback only.
 */

export type PeriodResolvedBy =
  | 'payment_link_id'
  | 'amount'
  | 'pending_upgrade'
  | 'existing_subscription'
  | 'fallback'

export type PeriodCandidates = {
  payment_link_id: BillingPeriod | null
  amount: BillingPeriod | null
  pending_upgrade: BillingPeriod | null
  existing_subscription: BillingPeriod | null
}

export type PeriodResolution = {
  period: BillingPeriod
  resolvedBy: PeriodResolvedBy
  candidates: PeriodCandidates
}

const isPeriod = (v: unknown): v is BillingPeriod => v === 'monthly' || v === 'annual'

export function extractLinkProcessId(payload: Record<string, any>): string | null {
  const raw = payload?.paymentLinkProcessId ?? payload?.processId
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}

export function extractAmount(payload: Record<string, any>): number | null {
  const raw = payload?.sum ?? payload?.amount ?? payload?.price
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(n) ? n : null
}

function classifyByLinkId(payload: Record<string, any>): BillingPeriod | null {
  const id = extractLinkProcessId(payload)
  if (!id) return null
  return getConfiguredLinkPeriodIds().find((e) => e.linkId === id)?.period ?? null
}

function classifyByAmount(payload: Record<string, any>): BillingPeriod | null {
  const n = extractAmount(payload)
  if (n === null) return null
  if (n === PRICING.monthly) return 'monthly'
  if (n === PRICING.annual) return 'annual'
  return null
}

export async function resolveBillingPeriod(
  agencyId: number,
  payload: Record<string, any>,
): Promise<PeriodResolution> {
  const payment_link_id = classifyByLinkId(payload)
  const amount = classifyByAmount(payload)

  // Only FRESH intent counts (status pending). Completed rows are stale
  // history; renewals must resolve from the subscription itself (rule 4).
  const pendingRow = await db('pending_upgrades')
    .where({ agencyId, status: 'pending' })
    .first()
  const pending_upgrade = isPeriod(pendingRow?.billingPeriod) ? pendingRow.billingPeriod : null

  const subRow = await db('subscriptions').where({ agencyId }).select('billingPeriod').first()
  const existing_subscription = isPeriod(subRow?.billingPeriod) ? subRow.billingPeriod : null

  const candidates: PeriodCandidates = { payment_link_id, amount, pending_upgrade, existing_subscription }

  if (payment_link_id) return { period: payment_link_id, resolvedBy: 'payment_link_id', candidates }
  if (amount) return { period: amount, resolvedBy: 'amount', candidates }
  if (pending_upgrade) return { period: pending_upgrade, resolvedBy: 'pending_upgrade', candidates }
  if (existing_subscription) return { period: existing_subscription, resolvedBy: 'existing_subscription', candidates }
  return { period: 'monthly', resolvedBy: 'fallback', candidates }
}

/**
 * Mandatory structured observability (owner requirement): exactly one
 * resolution line per charge, plus a warning when non-null candidates
 * disagree — support must see why a payment classified as it did BEFORE
 * customers report issues.
 */
export function logPeriodResolution(
  ctx: { agencyId: number; transactionId: string; payload: Record<string, any> },
  resolution: PeriodResolution,
): void {
  console.log('[GrowWebhook] period resolved', {
    agencyId: ctx.agencyId,
    transactionId: ctx.transactionId,
    paymentLinkProcessId: extractLinkProcessId(ctx.payload),
    amount: extractAmount(ctx.payload),
    resolvedPeriod: resolution.period,
    resolvedBy: resolution.resolvedBy,
  })

  const distinct = new Set(Object.values(resolution.candidates).filter(Boolean))
  if (distinct.size > 1) {
    console.warn('[GrowWebhook] period candidates DISAGREE', {
      agencyId: ctx.agencyId,
      transactionId: ctx.transactionId,
      candidates: resolution.candidates,
      chosen: resolution.period,
      chosenBy: resolution.resolvedBy,
    })
  }

  if (resolution.resolvedBy === 'fallback') {
    console.warn('[GrowWebhook] period UNRESOLVED — defaulted to monthly', {
      agencyId: ctx.agencyId,
      transactionId: ctx.transactionId,
    })
  }
}
