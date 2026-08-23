import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * Lead status transition log — data layer.
 *
 * The pure decision helpers are exported separately from the executor so the
 * "is this worth recording" rule is unit-testable without a database, and the
 * read path is a builder (`.toSQL()`-testable) exactly as `db/today/facts.ts`
 * does — the repo-wide workaround for the DB-backed integration harness.
 *
 * AGENCY ISOLATION. `agencyId` is required and validated here, and every read
 * builder filters on it. It always originates from the authenticated session at
 * the call site (`user.agencyId`), never from request input and never from a
 * model — this module is not reachable from any untrusted path.
 *
 * CONCURRENCY (documented limitation, deliberately not solved in this change).
 * `fromStatus` is read by the caller immediately before its write. Two of the
 * four status-writing surfaces run without a transaction and without a row lock:
 *
 *   · upsertLead      — transaction + SELECT ... FOR UPDATE   → origin is exact
 *   · saleForm        — transaction, no row lock              → narrow race window
 *   · updateLead      — no transaction, no row lock           → race window
 *   · logLeadOutcome  — no transaction, no row lock           → race window
 *
 * On the unlocked paths a concurrent writer can change the status between the
 * caller's read and its write, so `fromStatus` may record a stale origin. The
 * destination, the moment and the lead are always correct, and the occurrence
 * unique index means a race can never duplicate a row — the only degradation is
 * one possibly-wrong origin on a genuinely concurrent double-write of the same
 * lead. Introducing transactions or row locks on those two paths is a
 * concurrency change to live business writes and is out of scope here; it is
 * tracked as a follow-up rather than smuggled into a logging change.
 */

/** Which surface performed the status change. */
export type TransitionSource = 'manual' | 'outcome' | 'sale' | 'system'

export type StatusTransitionInput = {
  agencyId: number
  leadId: number
  fromStatus: string | null
  toStatus: string
  occurredAt: Date
  actorUserId: number | null
  source: TransitionSource
}

export type BuildTransitionArgs = {
  agencyId: number
  leadId: number
  previousStatus: string | null | undefined
  newStatus: string
  occurredAt: Date
  actorUserId: number | null
  source: TransitionSource
}

/** Trim to a real value, or null. Whitespace-only is absence, not a status. */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * A transition is worth recording only when the destination is real AND
 * different from the origin. `updateLead` emits whenever a status is present in
 * the payload, even if unchanged, so this is what stops a no-op save from
 * manufacturing history.
 */
export function isRecordableTransition(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const dest = clean(to)
  if (!dest) return false
  return clean(from) !== dest
}

/**
 * Normalise one transition, or null when it must not be recorded.
 * An unknown origin becomes a null `fromStatus` rather than dropping the row —
 * a partial transition is worth more than no transition.
 */
export function buildTransitionInput(args: BuildTransitionArgs): StatusTransitionInput | null {
  if (!isPositiveInt(args.agencyId) || !isPositiveInt(args.leadId)) return null
  if (!isRecordableTransition(args.previousStatus, args.newStatus)) return null
  return {
    agencyId: args.agencyId,
    leadId: args.leadId,
    fromStatus: clean(args.previousStatus),
    toStatus: clean(args.newStatus) as string,
    occurredAt: args.occurredAt,
    actorUserId: args.actorUserId,
    source: args.source,
  }
}

/**
 * Insert one transition. Idempotent: a retried action hits the occurrence unique
 * index and is ignored rather than duplicating history. Joins the caller's
 * transaction when one is supplied.
 */
export async function recordStatusTransition(
  input: StatusTransitionInput,
  executor: Knex | Knex.Transaction = db,
): Promise<void> {
  await executor('lead_status_transitions')
    .insert(input)
    .onConflict(['leadId', 'toStatus', 'occurredAt'])
    .ignore()
}

/** Per-lead history, oldest first. Agency-scoped. Builder only — not executed here. */
export function transitionsForLeadQuery(agencyId: number, leadId: number) {
  return db('lead_status_transitions')
    .where({ agencyId, leadId })
    .orderBy('occurredAt', 'asc')
    .select('fromStatus', 'toStatus', 'occurredAt', 'actorUserId', 'source')
}
