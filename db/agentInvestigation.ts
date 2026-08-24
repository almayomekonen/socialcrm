import { db } from '@/config/db'
import type { AgentAnswer, EvidenceRef, StopReason } from '@/lib/agent/types'

/**
 * Agent investigation persistence — write-only, and deliberately narrow.
 *
 * Nothing in the answer path reads this module, so a failure here can never
 * change what a rep is told; the call site in actions/ai/askAgent.ts wraps it,
 * the way `insertQualifyDraftReview` is wrapped in the Qualifier.
 *
 * WHAT MAY BE WRITTEN. Only post-validation content. The caller hands over the
 * answer `validateAgentAnswer` returned — never the model's raw output — plus
 * the evidence the TOOLS collected. Dropped claims arrive as a count, not as
 * text: an unsupported statement is exactly what the trust gate destroyed, and
 * storing it would give it a second life in whatever reads this later.
 *
 * IDENTITY. `agencyId` and `userId` come from the server-resolved AgentScope.
 * They are typed as required inputs rather than defaulted, so a call site that
 * has no scope cannot compile.
 *
 * IDEMPOTENCY. First write wins on ("agencyId","investigationId"). The id is
 * minted once per investigation in lib/agent/run.ts, so a retried server action
 * records history once while two genuinely different investigations by the same
 * rep — which carry different ids — both persist.
 *
 * No provider or model identifier is stored, upholding the boundary db/aiMessages.ts
 * states: those live only on `ai_runs`.
 */

export const AGENT_INVESTIGATIONS_TABLE = 'agent_investigations'

/** Outcome class. Distinct from `stopReason`, which says *why* the loop ended. */
export type AgentInvestigationStatus = 'answered' | 'refused' | 'failed'

export interface AgentInvestigationInput {
  /** From AgentScope. Never a caller or model value. */
  agencyId: number
  /** From AgentScope. The rep who asked. */
  userId: number
  /** Minted per investigation; also the trace correlation id. */
  investigationId: string
  /** Null for a leadless investigation — the common case today. */
  leadId?: number | null
  question: string
  status: AgentInvestigationStatus
  stopReason: StopReason
  /** The VALIDATED answer, or null when nothing was answered. */
  answer: AgentAnswer | null
  /** Refs the tools produced. The model never writes here. */
  evidence: EvidenceRef[]
  /** Counts only — the dropped prose itself is never stored. */
  droppedClaims: number
  strippedRefs: number
  steps: number
  failureReason?: string | null
}

export interface AgentInvestigationRow {
  agencyId: number
  userId: number
  investigationId: string
  leadId: number | null
  question: string
  status: AgentInvestigationStatus
  stopReason: StopReason
  answer: string | null
  evidence: string
  droppedClaims: number
  strippedRefs: number
  steps: number
  failureReason: string | null
}

/** Pure mapping. jsonb columns are stringified here so the shape is testable without a database. */
export function buildAgentInvestigationRow(input: AgentInvestigationInput): AgentInvestigationRow {
  return {
    agencyId: input.agencyId,
    userId: input.userId,
    investigationId: input.investigationId,
    leadId: input.leadId ?? null,
    question: input.question,
    status: input.status,
    stopReason: input.stopReason,
    answer: input.answer === null ? null : JSON.stringify(input.answer),
    evidence: JSON.stringify(input.evidence ?? []),
    droppedClaims: input.droppedClaims,
    strippedRefs: input.strippedRefs,
    steps: input.steps,
    failureReason: input.failureReason ?? null,
  }
}

/**
 * The insert as a query builder, so the conflict target is assertable from the
 * generated SQL. Removing `.ignore()` or changing the target changes that SQL —
 * the only way the idempotency guarantee can be defended, since a mocked writer
 * would accept any clause.
 */
export function agentInvestigationInsertQuery(row: AgentInvestigationRow) {
  return db(AGENT_INVESTIGATIONS_TABLE).insert(row).onConflict(['agencyId', 'investigationId']).ignore()
}

/** Record one investigation. First write for an investigationId wins. */
export async function recordAgentInvestigation(input: AgentInvestigationInput): Promise<void> {
  await agentInvestigationInsertQuery(buildAgentInvestigationRow(input))
}

const HISTORY_LIMIT_DEFAULT = 20
const HISTORY_LIMIT_MAX = 100

function clampLimit(limit?: number): number {
  const n = Number(limit)
  if (!Number.isFinite(n)) return HISTORY_LIMIT_DEFAULT
  return Math.min(Math.max(Math.floor(n), 1), HISTORY_LIMIT_MAX)
}

/**
 * Agency-scoped history, newest first. `agencyId` is always in the WHERE clause,
 * so a caller cannot reach another tenant's investigations even by passing an
 * id that belongs to one. `userId` narrows to a single rep without widening the
 * agency bound.
 */
export function agentInvestigationsQuery(args: { agencyId: number; userId?: number; limit?: number }) {
  const q = db(AGENT_INVESTIGATIONS_TABLE).where({ agencyId: args.agencyId })
  if (args.userId != null) q.andWhere({ userId: args.userId })
  return q.orderBy('createdAt', 'desc').limit(clampLimit(args.limit))
}
