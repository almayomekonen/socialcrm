import { db } from '@/config/db'

/**
 * Integration-3 — the isolated coverage-sweep decision sink.
 *
 * Persists the shadow cognition produced by the Tier-1 coverage sweep into
 * `ai_shadow_coverage`. Read by nothing in production; exists for offline
 * inspection of continuous cognition. Idempotent per (agency, subject, sweep
 * window) via upsert.
 */

export type CoverageReason = 'coverage_sweep' | 'staleness'
export type CoverageOutcome = 'recommend' | 'stay_silent' | 'rejected'

export interface CoverageDecisionInput {
  agencyId: number
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  reason: CoverageReason
  outcome: CoverageOutcome
  emitted: boolean
  rejectionBoundary?: string | null
  /** The full GateDecision, stored as-is. */
  decision: unknown
  sweptAt: string | Date
  sweepBucket: number
}

export interface CoverageDecisionRow {
  id: number
  agencyId: number
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  reason: CoverageReason
  outcome: CoverageOutcome
  emitted: boolean
  rejectionBoundary: string | null
  decision: unknown
  sweptAt: string
  sweepBucket: number
  createdAt: string
  updatedAt: string
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(v as string).toISOString()
}

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

/**
 * Upsert one coverage decision. Idempotent per observation:
 * (agencyId, subjectType, subjectId, sweepBucket, reason). coverage_sweep and
 * staleness are distinct observations of the same relationship in one sweep and
 * both persist; `reason` is part of the key, not a mutable column.
 */
export async function recordCoverageDecision(input: CoverageDecisionInput): Promise<number> {
  // Mutable (non-key) columns that a re-fired sweep may overwrite.
  const mutable = {
    outcome: input.outcome,
    emitted: input.emitted,
    rejectionBoundary: input.rejectionBoundary ?? null,
    decision: JSON.stringify(input.decision ?? null),
    sweptAt: input.sweptAt instanceof Date ? input.sweptAt : new Date(input.sweptAt),
  }
  const inserted = await db('ai_shadow_coverage')
    .insert({
      agencyId: input.agencyId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sweepBucket: input.sweepBucket,
      reason: input.reason,
      ...mutable,
    })
    .onConflict(['agencyId', 'subjectType', 'subjectId', 'sweepBucket', 'reason'])
    .merge({ ...mutable, updatedAt: db.fn.now() })
    .returning('id')
  return Number((inserted[0] as { id: unknown }).id)
}

/** Read a subject's coverage decisions, most recent first. Scoped. */
export async function readCoverageDecisions(
  agencyId: number,
  subject: { subjectType: 'lead' | 'portfolio'; subjectId: string },
): Promise<CoverageDecisionRow[]> {
  const rows = (await db('ai_shadow_coverage')
    .where({ agencyId, subjectType: subject.subjectType, subjectId: subject.subjectId })
    .orderBy('id', 'desc')) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    subjectType: r.subjectType as 'lead' | 'portfolio',
    subjectId: String(r.subjectId),
    reason: r.reason as CoverageReason,
    outcome: r.outcome as CoverageOutcome,
    emitted: Boolean(r.emitted),
    rejectionBoundary: (r.rejectionBoundary as string | null) ?? null,
    decision: parseJson<unknown>(r.decision, null),
    sweptAt: toIso(r.sweptAt),
    sweepBucket: Number(r.sweepBucket),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }))
}
