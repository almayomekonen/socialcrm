import type { Knex } from 'knex'
import type { SendControls } from './controls'
import { billingMonth, businessDayKey } from '@/lib/reminders/delivery/period'

/**
 * Atomic capacity reservations (architecture v1.2 §4, v1.4 §1.4, v1.5 §1.4).
 *
 * Each scope is a counter row reserved by ONE conditional increment:
 *   INSERT … ON CONFLICT DO UPDATE SET n = n + amount WHERE n + amount <= cap
 * The row lock is held until the gate's transaction commits, so concurrent
 * workers serialize on it and can never exceed a cap. Scopes are always taken in
 * the same order (monthly count → monthly cost → platform → agency → recipient),
 * so two gates cannot deadlock on them.
 *
 * Release happens only for DEFINITE non-delivery (a Meta rejection, a rate-limit
 * retry, or a later `failed` status). `sent` and `unknown` keep their reservation.
 */

export type ScopeKind = 'reminders_month' | 'reminders_month_cost' | 'platform' | 'agency' | 'recipient'
export type CapacityScope = { kind: ScopeKind; scopeId: number; periodStart: string; amount: number; cap: number; micros: boolean }

export const FAILURE_FOR_SCOPE: Record<ScopeKind, 'cap_reminders_month' | 'cap_platform' | 'cap_agency' | 'cap_recipient'> = {
  reminders_month: 'cap_reminders_month',
  reminders_month_cost: 'cap_reminders_month',
  platform: 'cap_platform',
  agency: 'cap_agency',
  recipient: 'cap_recipient',
}

/** The fixed-order plan. Requires a fully configured controls row (see missingControls). */
export function reservationPlan(
  c: SendControls,
  r: { agencyId: number; recipientId: number },
  atMs: number,
  priceMicros: number,
): CapacityScope[] {
  const month = billingMonth(atMs, c.billingTimezone as string).periodStart
  const day = businessDayKey(atMs)
  return [
    { kind: 'reminders_month', scopeId: 0, periodStart: month, amount: 1, cap: c.remindersMonthlyBudget as number, micros: false },
    { kind: 'reminders_month_cost', scopeId: 0, periodStart: month, amount: priceMicros, cap: c.remindersMonthlyBudgetMicros as number, micros: true },
    { kind: 'platform', scopeId: 0, periodStart: day, amount: 1, cap: c.platformDailyCap, micros: false },
    { kind: 'agency', scopeId: r.agencyId, periodStart: day, amount: 1, cap: c.agencyDailyCap as number, micros: false },
    { kind: 'recipient', scopeId: r.recipientId, periodStart: day, amount: 1, cap: c.recipientDailyCap, micros: false },
  ]
}

/** Reserve every scope, in order. Returns the first scope that is full, or null when all were reserved. */
export async function reserveAll(trx: Knex.Transaction, plan: CapacityScope[]): Promise<ScopeKind | null> {
  for (const s of plan) {
    if (s.amount > s.cap) return s.kind
    const col = s.micros ? '"reservedMicros"' : 'reserved'
    const { rows } = await trx.raw(
      `INSERT INTO owner_reminder_send_capacity AS c ("scopeKind", "scopeId", "periodStart", reserved, "reservedMicros")
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT ("scopeKind", "scopeId", "periodStart")
       DO UPDATE SET ${col} = c.${col} + ?, "updatedAt" = now()
       WHERE c.${col} + ? <= ?
       RETURNING 1`,
      [s.kind, s.scopeId, s.periodStart, s.micros ? 0 : s.amount, s.micros ? s.amount : 0, s.amount, s.amount, s.cap],
    )
    if (rows.length === 0) return s.kind
  }
  return null
}

/** Give back what `plan` reserved (same rows, same order). Never below zero. */
export async function releaseAll(trx: Knex.Transaction, plan: CapacityScope[]): Promise<void> {
  for (const s of plan) {
    const col = s.micros ? '"reservedMicros"' : 'reserved'
    await trx.raw(
      `UPDATE owner_reminder_send_capacity SET ${col} = GREATEST(0, ${col} - ?), "updatedAt" = now()
        WHERE "scopeKind" = ? AND "scopeId" = ? AND "periodStart" = ?`,
      [s.amount, s.kind, s.scopeId, s.periodStart],
    )
  }
}
