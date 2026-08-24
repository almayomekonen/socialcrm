'use server'

import { runAgentInvestigation } from '@/lib/agent/run'
import { recordAgentInvestigation, type AgentInvestigationInput } from '@/db/agentInvestigation'
import type { AgentResult } from '@/lib/agent/types'

/**
 * Server-action entry point for one Agent investigation.
 *
 * Deliberately thin. Every guarantee already lives below it: authorization and
 * agency isolation in `resolveAgentScope`, entitlement and spend in
 * `admitAiRun`, bounds in the Budget, and truthfulness in
 * `validateAgentAnswer`. Anything this file decided for itself would be a second
 * copy of a rule that already has one home.
 *
 * The one thing it does own is the question, because that is the only value the
 * caller supplies. It is capped so a pathological input cannot inflate a single
 * investigation's prompt cost; it is NOT sanitised beyond that, since it reaches
 * the model as a prompt and never as authorization.
 *
 * DEPLOYMENT NOTE — `maxDuration` cannot live here. A `'use server'` module may
 * only export async functions, so the platform function timeout is inherited
 * from the ROUTE SEGMENT that invokes this action. The Agent's budget allows up
 * to DEFAULT_DEADLINE_MS (40s), which exceeds the default serverless limit, so
 * whichever page or route first calls this MUST declare the repository's
 * convention for long work:
 *
 *     export const maxDuration = 60
 *
 * No such caller exists yet — B5 ships no UI. Adding one without that line will
 * let the platform cut an investigation off mid-flight.
 */

/** Upper bound on one question. Long enough for any real ask, short enough to bound cost. */
const MAX_QUESTION_CHARS = 1_000

/**
 * The durable record, and the guard around it.
 *
 * The loop calls this only AFTER validation, and never for an admission denial —
 * nothing was investigated, so there is nothing to record. A write failure is
 * swallowed here and nowhere else: the rep's answer is already correct, and
 * losing a history row must never turn a good answer into an error. This is the
 * same posture `insertQualifyDraftReview` takes in the Qualifier.
 */
async function persistQuietly(record: AgentInvestigationInput): Promise<void> {
  try {
    await recordAgentInvestigation(record)
  } catch (e) {
    console.error(`[AGENT-PERSIST] failed inv=${record.investigationId}:`, (e as Error).message)
  }
}

export async function askAgent(question: string): Promise<AgentResult> {
  const trimmed = (question ?? '').trim()
  if (!trimmed) return { ok: false, reason: 'error', message: 'empty-question' }

  return runAgentInvestigation({
    question: trimmed.slice(0, MAX_QUESTION_CHARS),
    onPersist: persistQuietly,
  })
}
