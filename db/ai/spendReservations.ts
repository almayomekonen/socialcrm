import { db } from '@/config/db'
import type { Knex } from 'knex'

/**
 * The durable autonomous spend ledger — SQL only, no policy.
 *
 * Every guarantee this module offers is a STORAGE guarantee, which is the point:
 * the previous spend control was a module-scope `Map`, and a cap that a cold
 * start resets is not a cap. Here the hold is a row, the concurrency bound is a
 * partial unique index, and the expiry is the owning lease's expiry.
 *
 * Three things are deliberately NOT decided here — they belong to the admission
 * policy that calls this module:
 *   · whether an observation deserves investigating at all;
 *   · which job to take next (`signal_jobs` already orders oldest-first);
 *   · what an investigation actually costs (nothing invokes a model in 4.2).
 *
 * FAIL-CLOSED CONFIGURATION. Both env values are read per call, never cached at
 * module scope, and an unset or malformed value yields ZERO — which makes every
 * reservation decline. A budget you forgot to configure must not be an unlimited
 * budget.
 */

export const AUTONOMOUS_KIND = 'autonomous_investigation' as const
export type SpendKind = typeof AUTONOMOUS_KIND
export type ReservationStatus = 'reserved' | 'settled' | 'released'
export type ReservationOutcome = 'admitted' | 'declined' | 'no_investigator'

/** Postgres unique_violation — the concurrency bound firing, not an error. */
const UNIQUE_VIOLATION = '23505'

/**
 * The per-investigation hold, in USD. Unset ⇒ 0 ⇒ every reservation declines.
 *
 * Sizing (gpt-5.6 at $5/M in, $30/M out): output is capped by config at 1,200
 * tokens = $0.036; input across four tool steps under a 60k-token ceiling = $0.30.
 * $0.50 therefore holds comfortably above the plausible worst case, and the
 * difference is refunded at settle because the daily total counts `spentUsd`
 * once a row is settled.
 */
export function autonomousMaxCostUsd(): number {
  const raw = Number(process.env.AUTONOMOUS_MAX_COST_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * The per-agency, per-day autonomous budget. Its own line, deliberately separate
 * from `AI_DAILY_USD_CAP`: a busy rep's interactive questions must never consume
 * the autonomous budget, and a runaway sweep must never consume theirs.
 */
export function autonomousDailyCapUsd(): number {
  const raw = Number(process.env.AI_AUTONOMOUS_DAILY_USD_CAP)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** The budget day for an instant. UTC, matching the `date` column. */
export function budgetDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export interface ReservationRow {
  id: number
  agencyId: number
  kind: SpendKind
  dateUtc: string
  signalJobId: number
  observationKey: string
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  reservedUsd: number
  spentUsd: number | null
  status: ReservationStatus
  outcome: ReservationOutcome | null
  declineReason: string | null
  expiresAt: string
  operatorUserId: number | null
  createdAt: string
}

export type ReserveResult =
  | { reserved: true; row: ReservationRow }
  | { reserved: false; reason: 'unconfigured' | 'daily_cap' | 'slot_busy' }

export interface ReserveInput {
  agencyId: number
  signalJobId: number
  observationKey: string
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  operatorUserId: number | null
  /** The owning signal-job lease's expiry. The reservation dies with it. */
  expiresAt: Date
  now?: Date
}

function toRow(r: Record<string, unknown>): ReservationRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    kind: r.kind as SpendKind,
    dateUtc: r.dateUtc instanceof Date ? budgetDay(r.dateUtc) : String(r.dateUtc).slice(0, 10),
    signalJobId: Number(r.signalJobId),
    observationKey: String(r.observationKey),
    subjectType: r.subjectType as 'lead' | 'portfolio',
    subjectId: String(r.subjectId),
    reservedUsd: Number(r.reservedUsd),
    spentUsd: r.spentUsd == null ? null : Number(r.spentUsd),
    status: r.status as ReservationStatus,
    outcome: (r.outcome as ReservationOutcome | null) ?? null,
    declineReason: (r.declineReason as string | null) ?? null,
    expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : String(r.expiresAt),
    operatorUserId: r.operatorUserId == null ? null : Number(r.operatorUserId),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }
}

/**
 * The day's committed autonomous spend for one agency.
 *
 * A `reserved` row counts what it HELD; a `settled` row counts what it actually
 * SPENT; a `released` row counts nothing, because nothing was spent. That is what
 * makes an over-reservation self-refunding and a decline free.
 */
export async function dailyTotalUsd(agencyId: number, dateUtc: string, executor: Knex | Knex.Transaction = db): Promise<number> {
  const res = await executor.raw(
    `SELECT COALESCE(SUM(CASE WHEN status = 'settled' THEN "spentUsd" ELSE "reservedUsd" END), 0)::float8 AS total
       FROM ai_spend_reservations
      WHERE "agencyId" = ? AND "dateUtc" = ? AND kind = ? AND status IN ('reserved','settled')`,
    [agencyId, dateUtc, AUTONOMOUS_KIND],
  )
  return Number(res.rows?.[0]?.total ?? 0)
}

/**
 * Take a hold, or decline. Transactionally safe against overlapping invocations.
 *
 * The cap is evaluated INSIDE the same transaction as the INSERT. That is sound
 * despite looking like a read-then-write race, because `ai_spend_open_uniq`
 * guarantees at most one open reservation per agency: a losing transaction never
 * lands a row, so it never consumes budget. The unique violation IS the
 * concurrency control, caught here and reported as `slot_busy` rather than
 * thrown — a busy slot is capacity, not failure.
 */
export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  const now = input.now ?? new Date()
  const amount = autonomousMaxCostUsd()
  const cap = autonomousDailyCapUsd()

  // Fail-closed: an unconfigured budget is a zero budget.
  if (amount <= 0 || cap <= 0) return { reserved: false, reason: 'unconfigured' }

  const dateUtc = budgetDay(now)

  try {
    return await db.transaction(async (trx) => {
      const spent = await dailyTotalUsd(input.agencyId, dateUtc, trx)
      if (spent + amount > cap) return { reserved: false, reason: 'daily_cap' as const }

      const res = await trx.raw(
        `INSERT INTO ai_spend_reservations
           ("agencyId", kind, "dateUtc", "signalJobId", "observationKey",
            "subjectType", "subjectId", "reservedUsd", status, "expiresAt", "operatorUserId")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
         RETURNING *`,
        [
          input.agencyId,
          AUTONOMOUS_KIND,
          dateUtc,
          input.signalJobId,
          input.observationKey,
          input.subjectType,
          input.subjectId,
          amount,
          input.expiresAt,
          input.operatorUserId,
        ],
      )
      return { reserved: true as const, row: toRow(res.rows[0]) }
    })
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      return { reserved: false, reason: 'slot_busy' }
    }
    throw err
  }
}

/**
 * Close a hold against what was actually spent. Frees the slot and refunds the
 * unspent difference, because the daily total switches from `reservedUsd` to
 * `spentUsd` the moment a row becomes `settled`.
 *
 * In Phase 4.2 `spentUsd` is always 0: there is no investigator to invoke, so
 * there is no cost to record. A non-zero settle in this phase is a defect.
 */
export async function settle(id: number, spentUsd: number, outcome: ReservationOutcome): Promise<boolean> {
  const safe = Number.isFinite(spentUsd) && spentUsd >= 0 ? spentUsd : 0
  const n = await db('ai_spend_reservations')
    .where({ id, status: 'reserved' })
    .update({ status: 'settled', spentUsd: safe, outcome, updatedAt: db.fn.now() })
  return Number(n) > 0
}

/**
 * Give a hold back. Nothing was spent, so the row counts zero forever and the
 * agency's slot is free immediately — the partial unique index only covers
 * `status = 'reserved'`.
 */
export async function release(id: number, reason: string): Promise<boolean> {
  const n = await db('ai_spend_reservations')
    .where({ id, status: 'reserved' })
    .update({ status: 'released', outcome: 'declined', declineReason: reason, updatedAt: db.fn.now() })
  return Number(n) > 0
}

/**
 * Release every hold whose owning lease has expired.
 *
 * This is the composition point with `reclaimStaleSignalJobs`: same cutoff
 * semantics, same reason. A lambda killed mid-investigation cannot strand budget,
 * because the reservation dies on the same clock as the lease that justified it.
 * Returns how many were reclaimed.
 */
export async function releaseExpired(now: Date = new Date()): Promise<number> {
  const res = await db.raw(
    `UPDATE ai_spend_reservations
        SET status = 'released', outcome = 'declined',
            "declineReason" = 'lease-expired-reclaimed', "updatedAt" = now()
      WHERE status = 'reserved' AND "expiresAt" <= ?
      RETURNING id`,
    [now],
  )
  return res.rows?.length ?? 0
}

/** Agency-scoped inspection. Newest first. */
export async function readReservations(agencyId: number, limit = 50): Promise<ReservationRow[]> {
  const rows = (await db('ai_spend_reservations').where({ agencyId }).orderBy('id', 'desc').limit(limit)) as Record<
    string,
    unknown
  >[]
  return rows.map(toRow)
}

/**
 * The most recent reservation for one subject, whatever became of it.
 *
 * Feeds the refractory precondition: "was this lead investigated recently?" A
 * released row counts — a decline is still a look, and re-looking every minute at
 * something we just declined is the same waste the observation key exists to
 * prevent one level up.
 */
export async function lastReservationForSubject(input: {
  agencyId: number
  subjectType: 'lead' | 'portfolio'
  subjectId: string
}): Promise<ReservationRow | null> {
  const row = (await db('ai_spend_reservations')
    .where({ agencyId: input.agencyId, subjectType: input.subjectType, subjectId: input.subjectId })
    .orderBy('id', 'desc')
    .first()) as Record<string, unknown> | undefined
  return row ? toRow(row) : null
}

/**
 * Is this hold still alive?
 *
 * Checked immediately before a Recommend is recorded. A lease can expire while an
 * investigation is in flight, and the expiry sweep will have released the hold
 * that paid for it — recording a recommendation at that point would mean
 * surfacing a conclusion no budget is standing behind, decided by a worker that
 * no longer owns the job.
 */
export async function isReservationActive(id: number, now: Date = new Date()): Promise<boolean> {
  const row = (await db('ai_spend_reservations')
    .where({ id })
    .whereIn('status', ['reserved', 'settled'])
    .where('expiresAt', '>', now)
    .first()) as Record<string, unknown> | undefined
  return Boolean(row)
}
