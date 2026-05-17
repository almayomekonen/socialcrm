import type { BillFinancialEventRow } from '@/db/billing/events'
import type { FulfillState } from '@/db/billing/invoices'
import { computeFulfillState } from './fulfillState'

/**
 * Projection rebuild helpers.
 *
 * Pure functions: given an invoice's event stream and a few invoice
 * primitives (totals, due date), return the derived projection values.
 *
 * Doctrine:
 *   - No I/O. The caller queries bill_financial_events; these helpers do the
 *     arithmetic.
 *   - The invoice row's fulfillState / outstandingAmount columns are CACHES
 *     of these computations, written by a future projection updater. Events
 *     are the truth.
 *   - Stub-safe for Phase 2: the allocation/reversal/write-off events these
 *     functions are looking for do not yet exist. Until they do, the helpers
 *     correctly return the initial state (open, full outstanding). When
 *     Phase 2.5 introduces allocation events, no helper code changes —
 *     callers just start passing event streams with allocation rows.
 *   - No payment-allocation business logic lives here. Payment validation,
 *     receipt issuance, allocation creation — all Phase 2.5+. This module
 *     READS facts from events; it does not produce them.
 *
 * Event payload contract:
 *   - allocation.created  : { amount: number, … }
 *   - allocation.reversed : { amount: number, … }
 *   - writeoff.applied    : { … }  (presence is the signal)
 *
 * Stored as Phase 2.5 lands these flows. Unknown event types are ignored
 * here — projection helpers don't gate on the full catalog.
 */

export type RebuildFulfillStateInput = {
  totalAmount: number
  dueAt: string | null
  events: BillFinancialEventRow[]
  today?: string
}

export function rebuildFulfillStateFromEvents(input: RebuildFulfillStateInput): FulfillState {
  const { allocatedAmount, reversedAmount, writtenOff } = aggregatePaymentFacts(input.events)

  return computeFulfillState({
    totalAmount: input.totalAmount,
    allocatedAmount,
    reversedAmount,
    writtenOff,
    dueAt: input.dueAt,
    today: input.today,
  })
}

export type RebuildOutstandingAmountInput = {
  totalAmount: number
  events: BillFinancialEventRow[]
}

export function rebuildOutstandingAmount(input: RebuildOutstandingAmountInput): number {
  const { allocatedAmount, reversedAmount, writtenOff } = aggregatePaymentFacts(input.events)

  if (writtenOff) return 0

  const netAllocated = allocatedAmount - reversedAmount
  const outstanding = round2(input.totalAmount - netAllocated)
  return Math.max(0, outstanding)
}

type PaymentFacts = {
  allocatedAmount: number
  reversedAmount: number
  writtenOff: boolean
}

function aggregatePaymentFacts(events: BillFinancialEventRow[]): PaymentFacts {
  let allocatedAmount = 0
  let reversedAmount = 0
  let writtenOff = false

  for (const event of events) {
    switch (event.eventType) {
      case 'allocation.created': {
        const amount = readNumberFromPayload(event.payload, 'amount')
        if (amount != null) allocatedAmount += amount
        break
      }
      case 'allocation.reversed': {
        const amount = readNumberFromPayload(event.payload, 'amount')
        if (amount != null) reversedAmount += amount
        break
      }
      case 'writeoff.applied':
      case 'write_off.applied': {
        writtenOff = true
        break
      }
      default:
        break
    }
  }

  return {
    allocatedAmount: round2(allocatedAmount),
    reversedAmount: round2(reversedAmount),
    writtenOff,
  }
}

function readNumberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key]
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
