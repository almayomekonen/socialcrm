import 'server-only'
import { Output, generateText, stepCountIs } from 'ai'
import { admitAiRun } from '@/lib/ai/gate'
import { estimateCostUsd } from '@/lib/ai/tasks'
import { addDailySpend } from '@/lib/ai/router/spend'
import { resolveAgentScope } from './scope'
import { DEFAULT_DEADLINE_MS, DEFAULT_MAX_STEPS, createBudget } from './budget'
import { createEvidenceCollector } from './evidence'
import { buildAgentTools } from './tools'
import { AGENT_SYSTEM_PROMPT } from './prompt'
import { validateAgentAnswer } from './validate'
import { agentAnswerSchema } from './answerSchema'
import { agentTrace } from './trace'
import type { AgentInvestigationInput } from '@/db/agentInvestigation'
import type { AgentResult, StopReason } from './types'

/**
 * One Agent investigation, end to end.
 *
 * The division of labour is the whole design, and it is not negotiable:
 *
 *   SOCIALCRM owns  authorization, agency isolation, entitlement, budget,
 *                   evidence, validation and trace.
 *   THE SDK owns    generation, tool calling, multi-step execution and stopping.
 *
 * Two consequences worth stating, because both look redundant and neither is:
 *
 *   · `stopWhen` is NOT the authority on how far an investigation may go. The
 *     Budget is, and it is consulted inside every tool's execute. `stepCountIs(n)`
 *     is implemented as `steps.length === n` — a strict equality — so a loop that
 *     ever skips past n would not stop on its own. The tools still would.
 *   · The model's output is treated as UNTYPED and handed to `validateAgentAnswer`.
 *     A schema-shaped payload is a proposal, not a fact: the validator drops every
 *     claim whose evidence the collector cannot resolve, and refuses the whole
 *     answer when nothing survives. Degrading honestly beats repairing.
 *
 * SINGLE PROVIDER, deliberately. The router fails over across a chain; the Agent
 * does not. A second attempt would either re-run tool calls the Budget has
 * already recorded — which it would then refuse as repeats, starving the retry —
 * or need a fresh budget, which re-spends the deadline the rep is waiting on.
 * `chain[0]` only; `providerMaxRetries: 0` keeps a dead provider from burning the
 * budget on SDK-internal backoff.
 *
 * Trace records identifiers, decisions and counts — never the question, never
 * claim text, never customer content.
 */

export const AGENT_TASK_KIND = 'agent.investigate' as const

export type RunAgentInput = {
  /** The rep's question, verbatim. */
  question: string
  /** Caller cancellation, forwarded to the model call. */
  abortSignal?: AbortSignal
  /** Injectable clock — the business day and the deadline both read it. */
  now?: () => number
  maxSteps?: number
  deadlineMs?: number
  /** Correlates every trace line for one investigation. */
  investigationId?: string
  /**
   * Durable record of the outcome, called AFTER validation with post-gate
   * content only. It is never called for an admission denial — nothing was
   * investigated. The loop does NOT guard it: the caller owns that, so a
   * persistence failure is visibly the caller's contract to absorb rather than
   * something this function silently swallows. See actions/ai/askAgent.ts.
   */
  onPersist?: (record: AgentInvestigationInput) => Promise<void>
}

function newInvestigationId(nowMs: number): string {
  return `inv_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runAgentInvestigation(input: RunAgentInput): Promise<AgentResult> {
  const now = input.now ?? (() => Date.now())
  const nowMs = now()
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS

  // Authority first. A session that cannot pass requireProductAccess never
  // reaches the gate, let alone a model — and that failure is a session error,
  // not an investigation outcome, so it propagates rather than becoming a result.
  const scope = await resolveAgentScope()

  const investigationId = input.investigationId ?? newInvestigationId(nowMs)
  const ctx = { investigationId, agencyId: scope.agencyId, userId: scope.userId }
  agentTrace('INVESTIGATION_START', ctx, { maxSteps, deadlineMs })

  const admission = await admitAiRun({ kind: AGENT_TASK_KIND, agencyId: scope.agencyId })
  if (admission.ok === false) {
    agentTrace('ADMISSION_DENIED', ctx, { reason: admission.reason })
    return { ok: false, reason: 'gate_denied', message: admission.reason, investigationId }
  }
  const { cfg, chain } = admission
  const handle = chain[0]!
  agentTrace('ADMISSION_OK', ctx, { provider: handle.provider, model: handle.modelId, chainLength: chain.length })

  // Identity for the durable record. Every field is server-resolved: the agency
  // and rep come from the scope, the id was minted here. None is reachable by
  // the model or the caller.
  const identity = {
    agencyId: scope.agencyId,
    userId: scope.userId,
    investigationId,
    leadId: null,
    question: input.question,
  }

  const budget = createBudget({ maxSteps, deadlineMs, now })
  const evidence = createEvidenceCollector()
  const tools = buildAgentTools({ scope, evidence, budget, nowMs })

  let result
  try {
    result = await generateText({
      model: handle.model,
      system: AGENT_SYSTEM_PROMPT,
      prompt: input.question,
      tools,
      stopWhen: stepCountIs(maxSteps),
      output: Output.object({ schema: agentAnswerSchema }),
      maxOutputTokens: cfg.maxOutputTokens,
      abortSignal: input.abortSignal,
      ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
    })
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    agentTrace('GENERATION_FAILED', ctx, { provider: handle.provider, steps: budget.stepsUsed() })
    await input.onPersist?.({
      ...identity,
      status: 'failed',
      stopReason: 'error',
      answer: null,
      evidence: evidence.all(),
      droppedClaims: 0,
      strippedRefs: 0,
      steps: budget.stepsUsed(),
      failureReason: message,
    })
    agentTrace('INVESTIGATION_END', ctx, { ok: false, reason: 'error' })
    return { ok: false, reason: 'error', message, investigationId }
  }

  // Charge before validating: the tokens were spent whatever we do with the
  // answer, and a refused answer that bills nothing would hide real cost.
  const usage = result.totalUsage
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const costUsd = estimateCostUsd(handle.modelId, inputTokens, outputTokens)
  addDailySpend(scope.agencyId, costUsd)

  agentTrace('GENERATION_COMPLETE', ctx, {
    steps: budget.stepsUsed(),
    evidenceCount: evidence.size(),
    finishReason: result.finishReason,
    inputTokens,
    outputTokens,
    costUsd,
  })

  const validated = validateAgentAnswer(result.output as never, evidence)
  if (!validated) {
    agentTrace('ANSWER_REJECTED', ctx, { evidenceCount: evidence.size() })
    // The rejected prose is NOT recorded. The gate destroyed it; storing it here
    // would give an unsupported claim a second life in whatever reads this next.
    await input.onPersist?.({
      ...identity,
      status: 'refused',
      stopReason: 'no_evidence',
      answer: null,
      evidence: evidence.all(),
      droppedClaims: 0,
      strippedRefs: 0,
      steps: budget.stepsUsed(),
      failureReason: null,
    })
    agentTrace('INVESTIGATION_END', ctx, { ok: false, reason: 'no_evidence' })
    return { ok: false, reason: 'no_evidence', investigationId }
  }

  // A budget stop that still produced a supportable answer is reported as the
  // budget's reason, not 'answered' — the rep is told the investigation was cut
  // short, rather than being handed a partial answer dressed as a complete one.
  const stopReason: StopReason = budget.reason() ?? 'answered'

  agentTrace('INVESTIGATION_END', ctx, {
    ok: true,
    stopReason,
    steps: budget.stepsUsed(),
    claims: validated.claims.length,
    droppedClaims: validated.diagnostics.dropped.length,
    strippedRefs: validated.diagnostics.strippedRefs.length,
  })

  const answer = { headline: validated.headline, claims: validated.claims, unknown: validated.unknown }
  await input.onPersist?.({
    ...identity,
    status: 'answered',
    stopReason,
    answer,
    evidence: evidence.all(),
    droppedClaims: validated.diagnostics.dropped.length,
    strippedRefs: validated.diagnostics.strippedRefs.length,
    steps: budget.stepsUsed(),
    failureReason: null,
  })

  return {
    ok: true,
    answer,
    evidence: evidence.all(),
    steps: budget.stepsUsed(),
    stopReason,
    investigationId,
  }
}
