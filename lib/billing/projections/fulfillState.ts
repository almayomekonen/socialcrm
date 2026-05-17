import type { FulfillState } from '@/db/billing/invoices'

/**
 * Pure projection: given an invoice's allocation totals and dates, return
 * the current fulfillState.
 *
 * Doctrine:
 *   - Pure function. No I/O, no DB, no time except via the optional `today`
 *     parameter (which defaults to current UTC date for testability).
 *   - The fulfillState column on bill_invoices is a cache of this function.
 *     When the events spine lands (Phase 2), the projection updater reads
 *     events for an invoice and calls this function with the aggregated
 *     allocation/reversal totals.
 *   - Floating-point safety: amounts are rounded to 2 decimals before
 *     comparison because numeric(14,2) values can pick up sub-cent fuzz
 *     after JS arithmetic.
 *   - Priority of states (the same state machine encoded in the behavioral
 *     spec §1.1 and §2.1):
 *
 *        written_off > paid > overdue > partial > open
 *
 *     Overdue supersedes partial: an unpaid-and-past-due invoice is
 *     'overdue', not 'partial'. The outstandingAmount column carries the
 *     remaining-balance signal for collections UIs that need it.
 */

export type ComputeFulfillStateInput = {
  totalAmount: number
  /** Sum of bill_receipt_allocations.amount for this invoice. */
  allocatedAmount: number
  /** Sum of reversed allocations (Phase 2). 0 today. */
  reversedAmount: number
  /** True iff a write_off.applied event exists for this invoice. */
  writtenOff: boolean
  /** Invoice dueAt as YYYY-MM-DD, or null if no due date set. */
  dueAt: string | null
  /** Override for testing. Defaults to current UTC date (YYYY-MM-DD). */
  today?: string
}

export function computeFulfillState(input: ComputeFulfillStateInput): FulfillState {
  if (input.writtenOff) return 'written_off'

  const netAllocated = round2(input.allocatedAmount - input.reversedAmount)
  const total = round2(input.totalAmount)

  if (netAllocated >= total) return 'paid'

  const today = input.today ?? currentUtcDate()
  const isOverdue = !!input.dueAt && input.dueAt < today

  if (isOverdue) return 'overdue'
  if (netAllocated > 0) return 'partial'
  return 'open'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10)
}
