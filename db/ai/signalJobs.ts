import type { Knex } from 'knex'
import { db } from '@/config/db'
import { interpret } from '@/lib/ai/runtime/eventInterpretation'
import { observationKeyFor, expectationOf, UnidentifiableSignalError } from '@/lib/ai/integration/observationKey'
import type { ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'

/**
 * signal_jobs — the durable lease queue for runtime signals.
 *
 * The shape is `auto_response_jobs`', deliberately and almost line for line:
 * `FOR UPDATE SKIP LOCKED` claim, `lockedAt`/`lockedBy` lease, `attempts + 1` on
 * claim, backoff on failure, dead-letter at `maxAttempts`, stale-lease reclaim.
 * Every hard-won property of that table — no double processing, no lost job on a
 * crashed function, bounded retries — comes along unchanged. What is NOT copied
 * is its rows: see the migration header for why the table is separate.
 *
 * This module owns storage and lifecycle. It owns no cognition: nothing here
 * reasons, decides, ranks, or calls a model. Draining is
 * lib/ai/integration/signalWorker.ts.
 *
 * NOTE ON SIZE (architecture-rules.md §6): ~285 lines, over the 250 soft limit
 * and intentionally so. It is one concern — the storage and lifecycle of one
 * table — expressed as eight small, independent statements plus a header.
 * `db/autoResponseJobs.ts`, the table this copies, is the same shape at a
 * similar size. Splitting a DAO by function would mean two files to answer
 * "what can happen to a job" and would let the status vocabulary drift
 * between them. The extraction trigger is a SECOND concern arriving here
 * (retention, metrics, a second table), not the next lifecycle verb.
 *
 * THE INGRESS RUNS AT THE DOOR. `enqueueSignal` interprets the signal through
 * M3 before writing it. A signal the ratified ingress refuses never becomes a
 * job, so the queue cannot accumulate work that can never be processed, and the
 * fabrication ban is enforced before durability rather than after it. The worker
 * interprets again on claim — a stored row is untrusted input by the time it is
 * read back.
 */

export type SignalJobStatus = 'pending' | 'leased' | 'succeeded' | 'dead'

export interface SignalJob {
  id: number
  agencyId: number
  observationKey: string
  expectation: string
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  /** The ExternalSignal exactly as it was accepted at enqueue. */
  signal: ExternalSignal
  status: SignalJobStatus
  attempts: number
  maxAttempts: number
  detectedAt: string
  createdAt: string
}

export type EnqueueResult =
  | { enqueued: true; jobId: number; observationKey: string }
  /** The observation is already known. A no-op, never an error. */
  | { enqueued: false; reason: 'duplicate'; observationKey: string }
  /** The ratified ingress refused it, or it cannot be identified. Never stored. */
  | { enqueued: false; reason: 'rejected' | 'unidentifiable'; detail: string }

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(v as string).toISOString()
}

function toRow(r: Record<string, unknown>): SignalJob {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    observationKey: String(r.observationKey),
    expectation: String(r.expectation),
    subjectType: r.subjectType as 'lead' | 'portfolio',
    subjectId: String(r.subjectId),
    signal: parseJson<ExternalSignal>(r.signal, {} as ExternalSignal),
    status: r.status as SignalJobStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    detectedAt: toIso(r.detectedAt),
    createdAt: toIso(r.createdAt),
  }
}

/**
 * Enqueue one detected signal.
 *
 * The agency is taken from the SIGNAL'S OWN SCOPE, which the detector received
 * from the sweep — there is no agency parameter, so there is nothing a caller
 * could widen. Storage re-asserts the same thing:
 * `signal_jobs_agency_matches_signal` refuses any row whose column and payload
 * disagree about the tenant.
 *
 * Idempotent: a known observation returns `duplicate` and writes nothing.
 */
export async function enqueueSignal(
  signal: ExternalSignal,
  opts: { executor?: Knex | Knex.Transaction; maxAttempts?: number } = {},
): Promise<EnqueueResult> {
  const exec = opts.executor ?? db

  // M3 at the door. A refused signal is not stored, so it can never be claimed.
  const interpreted = interpret(signal)
  if (interpreted.accepted === false) {
    return { enqueued: false, reason: 'rejected', detail: interpreted.rejection.code }
  }
  if (interpreted.event.kind === 'elapsed_time_tick') {
    return { enqueued: false, reason: 'unidentifiable', detail: 'an elapsed-time tick names no subject' }
  }

  let observationKey: string
  let expectation: string
  try {
    observationKey = observationKeyFor(signal)
    expectation = expectationOf(signal)
  } catch (err) {
    if (err instanceof UnidentifiableSignalError) {
      return { enqueued: false, reason: 'unidentifiable', detail: err.message }
    }
    throw err
  }

  const canonical = interpreted.event.signal
  const agencyId = canonical.scope.agencyId
  const subject = canonical.subject
  if (!subject) return { enqueued: false, reason: 'unidentifiable', detail: 'a queued signal must name a subject' }

  const res = await exec.raw(
    `
    INSERT INTO signal_jobs
      ("agencyId","observationKey",expectation,"subjectType","subjectId",signal,status,"maxAttempts","detectedAt")
    VALUES (:agencyId, :observationKey, :expectation, :subjectType, :subjectId, :signal::jsonb, 'pending', :maxAttempts, :detectedAt)
    ON CONFLICT ("agencyId","observationKey") DO NOTHING
    RETURNING id
  `,
    {
      agencyId,
      observationKey,
      expectation,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      // The signal as accepted, with the scope the CHECK compares against.
      signal: JSON.stringify({ ...signal, scope: { agencyId } }),
      maxAttempts: opts.maxAttempts ?? 3,
      detectedAt: new Date(canonical.asOfTime),
    },
  )

  const row = res.rows?.[0]
  if (!row) return { enqueued: false, reason: 'duplicate', observationKey }
  return { enqueued: true, jobId: Number(row.id), observationKey }
}

/** Enqueue a batch, preserving order. Each signal is judged on its own. */
export async function enqueueSignals(
  signals: readonly ExternalSignal[],
  opts: { executor?: Knex | Knex.Transaction; maxAttempts?: number } = {},
): Promise<EnqueueResult[]> {
  const results: EnqueueResult[] = []
  for (const signal of signals) results.push(await enqueueSignal(signal, opts))
  return results
}

/**
 * Claim due pending jobs, leasing them to one worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe: a row another
 * transaction already holds is skipped rather than waited on, so two workers
 * never lease the same job and neither blocks. `attempts + 1` happens HERE, at
 * the claim — a worker that dies mid-job still consumed an attempt, which is
 * what stops a crash loop from retrying forever.
 */
export async function claimSignalJobs(
  workerId: string,
  limit: number,
  executor: Knex | Knex.Transaction = db,
): Promise<SignalJob[]> {
  const res = await executor.raw(
    `
    UPDATE signal_jobs j
       SET status = 'leased', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM signal_jobs
        WHERE status = 'pending' AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."agencyId", j."observationKey", j.expectation, j."subjectType",
               j."subjectId", j.signal, j.status, j.attempts, j."maxAttempts",
               j."detectedAt", j."createdAt"
  `,
    [workerId, limit],
  )
  return (res.rows ?? []).map(toRow)
}

/** Complete only while still leased, so a reclaimed job cannot be completed twice. */
export async function succeedSignalJob(id: number): Promise<boolean> {
  const n = await db('signal_jobs').where({ id, status: 'leased' }).update({
    status: 'succeeded',
    completedAt: db.fn.now(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    updatedAt: db.fn.now(),
  })
  return Number(n) > 0
}

/**
 * A RETRYABLE failure: back to pending behind an exponential backoff, until the
 * attempts budget is spent — then terminal. Identical in shape to
 * `failAutoResponseJob`; the curve is 2s, 4s, 8s… capped at 15 minutes, because
 * a signal is not time-critical the way an outbound reply is and a tight linear
 * retry would hammer a failing dependency.
 */
export async function failSignalJob(id: number, error: string): Promise<void> {
  await db.raw(
    `
    UPDATE signal_jobs
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END,
           "completedAt" = CASE WHEN attempts >= "maxAttempts" THEN now() ELSE NULL END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "nextAttemptAt" = now() + make_interval(secs => LEAST(POWER(2, LEAST(attempts, 10))::int, 900)),
           "updatedAt" = now()
     WHERE id = ?
  `,
    [error, id],
  )
}

/**
 * A TERMINAL failure, independent of the attempt counter — for an error a retry
 * cannot fix. A stored signal the ingress now refuses is the canonical case:
 * it will be refused identically forever.
 */
export async function deadLetterSignalJob(id: number, error: string): Promise<void> {
  await db('signal_jobs').where({ id }).update({
    status: 'dead',
    lastError: error,
    completedAt: db.fn.now(),
    lockedAt: null,
    lockedBy: null,
    updatedAt: db.fn.now(),
  })
}

/**
 * Recover jobs whose worker died holding the lease. Attempts are NOT given back:
 * a job that repeatedly kills its worker must eventually dead-letter rather than
 * cycle forever.
 */
export async function reclaimStaleSignalJobs(leaseMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs)
  const res = await db.raw(
    `
    UPDATE signal_jobs
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END,
           "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed',
           "nextAttemptAt" = now(),
           "updatedAt" = now()
     WHERE status = 'leased' AND "lockedAt" < ?
     RETURNING id
  `,
    [cutoff],
  )
  return res.rows?.length ?? 0
}

/** Agency-scoped inspection. Every read is filtered by agency; there is no unscoped reader. */
export async function readSignalJobs(
  agencyId: number,
  filter: { status?: SignalJobStatus; observationKey?: string } = {},
): Promise<SignalJob[]> {
  const q = db('signal_jobs').where({ agencyId })
  if (filter.status) q.where('status', filter.status)
  if (filter.observationKey) q.where('observationKey', filter.observationKey)
  const rows = (await q.orderBy('id', 'asc')) as Record<string, unknown>[]
  return rows.map(toRow)
}

/**
 * Give a claim back WITHOUT consuming an attempt.
 *
 * `claimSignalJobs` increments `attempts` at lease time, which is right for work
 * that was actually examined and wrong for work that was never reached. A
 * capacity refusal — the autonomous budget is spent, or another invocation holds
 * the agency's single slot — means nothing was looked at, so charging it a retry
 * would let three busy days dead-letter an observation nobody has yet considered.
 *
 * This is the ONLY function that moves `attempts` backwards, and it does so by
 * exactly the one the claim added. It never turns a job `dead`: a job that was
 * never examined cannot have exhausted anything.
 *
 * Added in Phase 4.3 because the "capacity must not consume an attempt" rule is
 * unsatisfiable without it. No existing lease function is modified.
 */
export async function releaseSignalJobClaim(id: number): Promise<boolean> {
  const res = await db.raw(
    `UPDATE signal_jobs
        SET status = 'pending',
            attempts = GREATEST(attempts - 1, 0),
            "lockedAt" = NULL, "lockedBy" = NULL,
            "nextAttemptAt" = now(),
            "updatedAt" = now()
      WHERE id = ? AND status = 'leased'
      RETURNING id`,
    [id],
  )
  return (res.rows?.length ?? 0) > 0
}
