import { db } from '@/config/db'
import { recordNarrative, type NarrativeInput, type Scope } from '@/db/ai/stateManagement'

/**
 * The lead status transition CONSUMER.
 *
 * `lead_status_transitions` has been written since 2026-08-24 and read by
 * nothing. Pipeline movement — the one history the product had never kept — was
 * accruing into a table with no consumer, which is the same shape as the defect
 * the table was created to fix.
 *
 * WHY NARRATIVE AND NOT A SIGNAL. A signal says "something is owed"; the queue
 * exists to schedule cognition about a violated expectation. A status change is
 * neither: nothing was violated, nothing is owed, and `new → contacted` is not a
 * problem to be investigated. It is CONTEXT — the answer to "what has actually
 * happened to this relationship" that reasoning has never had.
 *
 * The runtime already has a home for exactly that. `NarrativeKind` is
 * `'history' | 'promise' | 'outcome'`, `assembleContext` puts
 * `includedNarrative` into the ContextPackage, and M5 receives it. A transition
 * is `history` in the plainest sense of the word, so this consumer projects it
 * there rather than inventing a fourth place for the same idea.
 *
 * Three things follow from that choice, all of them the point:
 *   · no new table, no new queue, no new gate — the instruction was to extend;
 *   · nothing is surfaced. Narrative is context for reasoning, not an insight,
 *     so a status change can never become a notification by this path;
 *   · no expectation vocabulary is distorted. Enrolling `status_change` as an
 *     `ExpectationKind` would have made every transition permanently declined at
 *     admission (`asExpectation` narrows off `EXPECTED_STATE`), which is a
 *     queue full of jobs that can never proceed.
 *
 * NO-OPS CANNOT REACH HERE. `isRecordableTransition` in
 * `db/leadStatusTransitions.ts` already refuses a write when the destination
 * equals the origin, so a re-saved status never became a row. This consumer
 * therefore needs no second no-op rule, and adding one would be a second
 * authority on the same question.
 *
 * ACTOR AND SOURCE ARE PRESERVED VERBATIM. `actorUserId` and `source`
 * ('manual' | 'outcome' | 'sale' | 'system') travel into the narrative content
 * unchanged — who moved the lead is part of what happened, and a consumer that
 * dropped it would make the history less true than the row it read.
 */

/** One transition, as stored. */
export interface StatusTransitionRow {
  id: number
  leadId: number
  fromStatus: string | null
  toStatus: string
  occurredAt: Date | string
  actorUserId: number | null
  source: string
}

export interface TransitionNarrativeSummary {
  read: number
  recorded: number
  skipped: number
  errored: number
}

/** Bounded per pass: this is a backfill of context, never a burst of work. */
export const DEFAULT_TRANSITION_BATCH = 200

/**
 * Agency-scoped transitions since a cursor. Builder only — `.toSQL()`-testable,
 * matching how every other reader in this layer is proven without a database.
 */
export function agencyTransitionsQuery(agencyId: number, sinceMs: number, limit: number) {
  return db('lead_status_transitions')
    .where({ agencyId })
    .where('occurredAt', '>=', new Date(sinceMs))
    .orderBy('occurredAt', 'asc')
    .limit(limit)
    .select('id', 'leadId', 'fromStatus', 'toStatus', 'occurredAt', 'actorUserId', 'source')
}

function toIso(v: Date | string): string | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Project one transition into a narrative input. PURE.
 *
 * Returns null rather than guessing when the row cannot be trusted — a
 * transition with no destination or no usable moment is not history, it is a
 * malformed row, and recording it would put a fabricated event in the context
 * the model reasons over.
 */
export function transitionToNarrative(agencyId: number, row: StatusTransitionRow): NarrativeInput | null {
  if (!Number.isFinite(row.leadId) || row.leadId <= 0) return null
  const toStatus = (row.toStatus ?? '').trim()
  if (!toStatus) return null
  const occurredAt = toIso(row.occurredAt)
  if (!occurredAt) return null

  return {
    agencyId,
    subjectType: 'lead',
    subjectId: String(row.leadId),
    kind: 'history',
    content: {
      event: 'lead.status_changed',
      // `null` means the origin is genuinely unknown (a first-ever status, or an
      // unlocked write that could not read it) — never a fabricated 'new'.
      fromStatus: row.fromStatus ?? null,
      toStatus,
      // Who and how. Preserved exactly as the transition log recorded them.
      actorUserId: row.actorUserId ?? null,
      source: row.source,
      // The transition row id, so the narrative walks back to its evidence.
      transitionId: row.id,
    },
    occurredAt: new Date(occurredAt),
  }
}

/**
 * Read recent transitions for one agency and record them as narrative history.
 *
 * NEVER THROWS. A failure to enrich context must not fail the caller: the worst
 * outcome of a miss is reasoning that knows slightly less, which is exactly what
 * it knows today.
 *
 * Idempotency is the caller's cursor plus `recordNarrative`'s own storage
 * semantics; this module re-reads a bounded window rather than tracking state of
 * its own, so a re-run over the same window is a re-record of the same history
 * rather than an invented event.
 */
export async function consumeStatusTransitions(
  scope: Scope,
  opts: {
    sinceMs: number
    limit?: number
    recorder?: typeof recordNarrative
    /**
     * Injected like every other dependency in this layer (`SignalSweepDeps`,
     * `PreconditionDeps`), so the projection loop is provable without Postgres.
     * The reader's own SQL is pinned separately by a `.toSQL()` test.
     */
    reader?: (agencyId: number, sinceMs: number, limit: number) => Promise<StatusTransitionRow[]>
  } = { sinceMs: 0 },
): Promise<TransitionNarrativeSummary> {
  const summary: TransitionNarrativeSummary = { read: 0, recorded: 0, skipped: 0, errored: 0 }
  const record = opts.recorder ?? recordNarrative
  const limit = opts.limit ?? DEFAULT_TRANSITION_BATCH
  const read =
    opts.reader ??
    ((agencyId: number, sinceMs: number, max: number) =>
      agencyTransitionsQuery(agencyId, sinceMs, max) as unknown as Promise<StatusTransitionRow[]>)

  let rows: StatusTransitionRow[]
  try {
    rows = await read(scope.agencyId, opts.sinceMs, limit)
  } catch (err) {
    console.error(`[status-transitions] agency=${scope.agencyId} read failed:`, (err as Error).message)
    return { ...summary, errored: 1 }
  }

  summary.read = rows.length

  for (const row of rows) {
    const input = transitionToNarrative(scope.agencyId, row)
    if (input === null) {
      summary.skipped += 1
      continue
    }
    try {
      await record(input)
      summary.recorded += 1
    } catch (err) {
      summary.errored += 1
      console.error(`[status-transitions] agency=${scope.agencyId} lead=${row.leadId}:`, (err as Error).message)
    }
  }

  return summary
}
