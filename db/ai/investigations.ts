import { db } from '@/config/db'
import type { AgentAnswer, EvidenceRef, StopReason } from '@/lib/agent/types'

/**
 * Durable record of one autonomous investigation. Writes only; nothing in
 * production reads it yet.
 *
 * The shape mirrors `db/agentInvestigation.ts` deliberately — same posture on
 * what may be stored (validated content only, counts instead of dropped prose,
 * no provider or model identifiers) — because the two records answer the same
 * question about two different workloads, and a second posture would be a second
 * thing to keep honest.
 */

export const AI_INVESTIGATIONS_TABLE = 'ai_investigations'

export type InvestigationStatus = 'answered' | 'refused' | 'failed'
export type GateOutcome = 'recommend' | 'stay_silent' | 'rejected'

export interface InvestigationInput {
  agencyId: number
  investigationId: string
  signalJobId: number
  observationKey: string
  expectation: string
  subjectType: 'lead' | 'portfolio'
  subjectId: string
  reservationId: number | null
  /** The recipient whose permissions bounded the evidence read. */
  operatorUserId: number
  /** System-authored. Never model-written. */
  objective: string
  status: InvestigationStatus
  stopReason: StopReason
  gateOutcome?: GateOutcome | null
  silenceReason?: string | null
  /** VALIDATED answer only. */
  answer?: AgentAnswer | null
  evidence?: EvidenceRef[]
  droppedClaims?: number
  strippedRefs?: number
  steps?: number
  costUsd?: number
  failureReason?: string | null
}

/**
 * Record one run. Idempotent per `investigationId`, so a retried write is a
 * no-op rather than a duplicate.
 */
export async function recordInvestigation(input: InvestigationInput): Promise<void> {
  await db.raw(
    `INSERT INTO ai_investigations
       ("agencyId","investigationId","signalJobId","observationKey",expectation,
        "subjectType","subjectId","reservationId","operatorUserId",objective,
        status,"stopReason","gateOutcome","silenceReason",answer,evidence,
        "droppedClaims","strippedRefs",steps,"costUsd","failureReason")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?)
     ON CONFLICT ("agencyId","investigationId") DO NOTHING`,
    [
      input.agencyId,
      input.investigationId,
      input.signalJobId,
      input.observationKey,
      input.expectation,
      input.subjectType,
      input.subjectId,
      input.reservationId,
      input.operatorUserId,
      input.objective,
      input.status,
      input.stopReason,
      input.gateOutcome ?? null,
      input.silenceReason ?? null,
      input.answer == null ? null : JSON.stringify(input.answer),
      JSON.stringify(input.evidence ?? []),
      input.droppedClaims ?? 0,
      input.strippedRefs ?? 0,
      input.steps ?? 0,
      input.costUsd ?? 0,
      input.failureReason ?? null,
    ],
  )
}

/** Agency-scoped inspection, newest first. */
export async function readInvestigations(agencyId: number, limit = 50): Promise<Record<string, unknown>[]> {
  return (await db(AI_INVESTIGATIONS_TABLE).where({ agencyId }).orderBy('id', 'desc').limit(limit)) as Record<string, unknown>[]
}
