import { db } from '@/config/db'

/**
 * Integration-2 — the isolated shadow-decision sink.
 *
 * Persists the runtime's shadow cognition output (an M6 GateDecision, projected)
 * into `ai_shadow_decisions`. This store is read by nothing in production; it
 * exists so the runtime's decisions can be compared offline against legacy
 * conversation intelligence. Writes are idempotent per (agency, conversation,
 * turn) via upsert.
 */

export type ShadowOutcome = 'recommend' | 'stay_silent' | 'rejected'

export interface ShadowDecisionInput {
  agencyId: number
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  conversationId: number
  turnCount: number
  outcome: ShadowOutcome
  emitted: boolean
  rejectionBoundary?: string | null
  /** The full GateDecision (reasoning chain + provenance + trace), stored as-is. */
  decision: unknown
  runtimeAsOf: string | Date
}

export interface ShadowDecisionRow {
  id: number
  agencyId: number
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  conversationId: number | null
  turnCount: number | null
  outcome: ShadowOutcome
  emitted: boolean
  rejectionBoundary: string | null
  decision: unknown
  runtimeAsOf: string
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

/** Upsert one shadow decision. Idempotent on (agencyId, conversationId, turnCount). */
export async function recordShadowDecision(input: ShadowDecisionInput): Promise<number> {
  const shared = {
    outcome: input.outcome,
    emitted: input.emitted,
    rejectionBoundary: input.rejectionBoundary ?? null,
    decision: JSON.stringify(input.decision ?? null),
    runtimeAsOf: input.runtimeAsOf instanceof Date ? input.runtimeAsOf : new Date(input.runtimeAsOf),
  }
  const inserted = await db('ai_shadow_decisions')
    .insert({
      agencyId: input.agencyId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      conversationId: input.conversationId,
      turnCount: input.turnCount,
      ...shared,
    })
    .onConflict(['agencyId', 'conversationId', 'turnCount'])
    .merge({ ...shared, updatedAt: db.fn.now() })
    .returning('id')
  return Number((inserted[0] as { id: unknown }).id)
}

/** Read a subject's shadow decisions, most recent first. Scoped. */
export async function readShadowDecisions(
  agencyId: number,
  subject: { subjectType: 'lead' | 'portfolio'; subjectId: string },
): Promise<ShadowDecisionRow[]> {
  const rows = (await db('ai_shadow_decisions')
    .where({ agencyId, subjectType: subject.subjectType, subjectId: subject.subjectId })
    .orderBy('id', 'desc')) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    subjectType: r.subjectType as 'lead' | 'portfolio',
    subjectId: String(r.subjectId),
    conversationId: r.conversationId === null || r.conversationId === undefined ? null : Number(r.conversationId),
    turnCount: r.turnCount === null || r.turnCount === undefined ? null : Number(r.turnCount),
    outcome: r.outcome as ShadowOutcome,
    emitted: Boolean(r.emitted),
    rejectionBoundary: (r.rejectionBoundary as string | null) ?? null,
    decision: parseJson<unknown>(r.decision, null),
    runtimeAsOf: toIso(r.runtimeAsOf),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }))
}
