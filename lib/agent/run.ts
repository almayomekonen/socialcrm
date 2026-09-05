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
import { validateAgentAnswerDetailed } from './validate'
import { agentAnswerSchema } from './answerSchema'
import { agentTrace } from './trace'
import type { AgentInvestigationInput } from '@/db/agentInvestigation'
import type { AgentAnswer, AgentResult, AgentScope, StopReason } from './types'

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

/**
 * One prior exchange, as the model should see it.
 *
 * `assistant` content is the previous answer's HEADLINE only — one sentence.
 * The full claim list would triple the prompt for every follow-up and re-assert
 * evidence-backed statements in a turn where that evidence no longer exists;
 * the headline is enough for the model to know what it just said.
 */
export type AgentTurn = { role: 'user' | 'assistant'; content: string }

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
   * PRE-RESOLVED authority, for a caller that has no session.
   *
   * The interactive path omits this and `resolveAgentScope()` runs exactly as it
   * always has. The autonomous path (Phase 4.3) supplies a scope that
   * `resolveAutonomousScope` already derived from `resolveRecipients` — the same
   * `handler_or_admin` rule the notification engine uses — so proactive work
   * reads precisely what the operator who will receive it could read.
   *
   * This is NOT a way to widen authority: it accepts an AgentScope, which can
   * only be built from a session or from that recipient resolution, and it is
   * never reachable from a request body, a tool input, or a model argument.
   */
  scope?: AgentScope
  /**
   * Skip the in-memory interactive spend counter.
   *
   * `addDailySpend` is a single module-scope Map shared with every interactive
   * question. Charging proactive work to it would let a burst of autonomous
   * investigations push a paying rep over `AI_DAILY_USD_CAP` and deny them an
   * answer they asked for. Autonomous work is accounted DURABLY instead, in
   * `ai_spend_reservations`, so it sets this and settles there.
   */
  skipInteractiveSpend?: boolean
  /**
   * Require EVIDENCE BEFORE AN ANSWER — the autonomous path only.
   *
   * `toolChoice` defaults to `auto`: the model may call a tool, and may equally
   * answer without one. For an interactive question that is right — "nothing needs
   * attention" is a useful reply to a rep who asked. For an autonomous
   * investigation it is not: the system has already established that a specific
   * expectation was violated, so an answer built on nothing is never the finding.
   *
   * Production proved the difference. `inv_mtakjigp_tviv8y` (job 23985, lead 1516)
   * returned a schema-valid answer having made ZERO tool calls, against a lead with
   * 30 messages sitting one tool call away. The validator correctly destroyed it —
   * `no_evidence` — after the tokens were already paid for.
   *
   * The interactive path omits this and its request is byte-identical to before.
   */
  requireToolEvidence?: boolean
  /**
   * PRIOR TURNS of this conversation, oldest first.
   *
   * What makes "ומה דחוף?" and "ומה עם יוסי?" answerable: without them each
   * question reached the model alone and a follow-up had no referent.
   *
   * THE TRUST BOUNDARY IS UNCHANGED, and this is the part worth being precise
   * about. These turns are PROMPT CONTEXT, never evidence. Every claim in the
   * answer is still validated against the EvidenceCollector for THIS run only,
   * so a caller who fabricates an assistant turn can steer the model's attention
   * but cannot put an unsupported claim into the output — the validator has
   * never seen the earlier run's evidence and will not resolve a ref from it.
   * Tool results are deliberately NOT replayed here for the same reason: they
   * would look like evidence without being registered as any.
   *
   * The caller is responsible for bounding the list; `askAgent` caps it.
   */
  history?: AgentTurn[]
  /**
   * Progress observer, fired as each tool call is admitted. Used by the
   * streaming transport to show which capability is running. Purely
   * observational — see `CreateBudgetOptions.onStep`.
   */
  onProgress?: (event: { tool: string; step: number }) => void
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
  // A caller with no session supplies an already-resolved scope instead; see
  // RunAgentInput.scope.
  const scope = input.scope ?? (await resolveAgentScope())

  const investigationId = input.investigationId ?? newInvestigationId(nowMs)
  const ctx = { investigationId, agencyId: scope.agencyId, userId: scope.userId }
  agentTrace('INVESTIGATION_START', ctx, { maxSteps, deadlineMs })

  const admission = await admitAiRun({ kind: AGENT_TASK_KIND, agencyId: scope.agencyId })
  if (admission.ok === false) {
    agentTrace('ADMISSION_DENIED', ctx, { reason: admission.reason })
    return { ok: false, reason: 'gate_denied', message: admission.reason, investigationId, costUsd: 0 }
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

  const budget = createBudget({ maxSteps, deadlineMs, now, onStep: input.onProgress })

  /**
   * THE WALL CLOCK — the deadline the Budget cannot enforce.
   *
   * `Budget.canStep` is consulted inside a tool's execute, so it bounds an
   * investigation that is CALLING TOOLS. It cannot bound one that is waiting on
   * the provider, because no tool runs while that wait happens. A live run hit
   * exactly that hole: a single question stalled for 487 seconds having made zero
   * tool calls, so the 40s deadline was never once consulted.
   *
   * This closes it by cancelling the request itself rather than abandoning it.
   * Racing a timer against the promise would return control while the provider
   * call kept running — still billing tokens, still holding a socket — so the
   * signal goes INTO `generateText`, which forwards it to the provider request.
   *
   * ONE ABSOLUTE CEILING, not a per-call timer. `deadlineAt` is computed once
   * from the investigation's own start, so the two-phase autonomous path shares
   * a single budget across both model calls and a slow Phase 1 leaves Phase 2
   * less time rather than granting it a fresh 40 seconds. It reuses the SAME
   * `deadlineMs` the Budget uses — one number, two enforcement points, no second
   * timeout constant to drift.
   *
   * The caller's own signal is chained in, so a rep who navigates away still
   * cancels immediately; `timedOut` records which of the two fired, because a
   * deadline and a cancellation are different outcomes to report.
   */
  const deadlineAt = nowMs + deadlineMs
  const deadlineController = new AbortController()
  let timedOut = false
  const deadlineTimer = setTimeout(
    () => {
      timedOut = true
      deadlineController.abort(new Error('agent-wall-clock-deadline'))
    },
    Math.max(0, deadlineAt - now()),
  )

  const callerSignal = input.abortSignal
  const onCallerAbort = () => deadlineController.abort(callerSignal?.reason)
  if (callerSignal?.aborted) deadlineController.abort(callerSignal.reason)
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  /** What every model call receives: the deadline and the caller, as one signal. */
  const runSignal = deadlineController.signal

  /**
   * The conversation as the model sees it: prior turns, then the new question.
   *
   * `messages` rather than `prompt` in BOTH branches. With no history the array
   * is a single user message, which is exactly what `prompt` desugars to — so a
   * first question produces the same request it always did.
   */
  const conversation = [
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.content }) as const),
    { role: 'user' as const, content: input.question },
  ]
  const evidence = createEvidenceCollector()
  const tools = buildAgentTools({ scope, evidence, budget, nowMs })

  let result
  /** Phase 1's token usage, folded into the cost so a two-phase run bills honestly. */
  let evidenceUsage: { inputTokens?: number; outputTokens?: number } | undefined
  try {
    if (input.requireToolEvidence === true) {
      /**
       * TWO PHASES, because ai@6.0.176 cannot vary structured output per step.
       *
       * `PrepareStepResult` exposes model / toolChoice / activeTools / system /
       * messages / experimental_context / providerOptions — and nothing else. The
       * loop reads `responseFormat` from the CALL-level `output` closure
       * (dist/index.mjs:4354), so one call is either schema-enforced for every step
       * or for none.
       *
       * That is the whole problem. `text.format` and `tool_choice: "required"` in one
       * Responses turn are contradictory and OpenAI honours the format, so the model
       * answered instead of calling a tool — steps 0, three times. Dropping the format
       * freed the tool call (production then measured steps 1, evidence 40) but removed
       * the only guarantee the answer was parseable, and the run died `malformed`.
       *
       * So the phases split: gather under `required` with no format, then answer under
       * the format with no tools. Each turn carries exactly one constraint.
       */

      // ── PHASE 1 · evidence. Tools, required first call, NO structured output. ──
      const evidencePhase = await generateText({
        model: handle.model,
        system: AGENT_SYSTEM_PROMPT,
        messages: conversation,
        tools,
        stopWhen: stepCountIs(maxSteps),
        // The gate lifts on the first EXECUTED tool — `budget.stepsUsed()` is the same
        // counter `steps` reports, so the gate and the audit cannot disagree.
        prepareStep: () => ({ toolChoice: budget.stepsUsed() === 0 ? ('required' as const) : ('auto' as const) }),
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
      evidenceUsage = evidencePhase.totalUsage

      /**
       * THE HANDOFF is the SDK's own `response.messages` — the assistant message
       * carrying the tool calls plus the tool-result messages the loop appended. Phase 2
       * therefore sees the real tool results in the shape the SDK produced, not a
       * hand-rolled transcript, and can cite exactly the refs the EvidenceCollector
       * recorded. That collector is SHARED: both phases close over the same `tools` and
       * the same `evidence`, so `evidence.all()` already holds Phase 1's work and the
       * validator checks Phase 2's claims against it.
       *
       * Phase 1's own prose is deliberately DISCARDED. It was produced without a schema
       * and is not an answer.
       *
       * Phase 2 passes NO tools, so it consumes no Budget: the autonomous tool ceiling
       * stays `maxSteps` across the whole investigation rather than doubling.
       */

      // ── PHASE 2 · answer. Structured output, NO tools, no forced choice. ──
      result = await generateText({
        model: handle.model,
        system: AGENT_SYSTEM_PROMPT,
        messages: [...conversation, ...evidencePhase.response.messages],
        output: Output.object({ schema: agentAnswerSchema }),
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
    } else {
      // ── INTERACTIVE · unchanged: one call, tools, structured output. ──
      result = await generateText({
        model: handle.model,
        system: AGENT_SYSTEM_PROMPT,
        messages: conversation,
        tools,
        stopWhen: stepCountIs(maxSteps),
        output: Output.object({ schema: agentAnswerSchema }),
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
    }
  } catch (err) {
    // A deadline abort and a provider failure arrive through the same throw, so
    // the flag set by the timer is what tells them apart — the error's own
    // message cannot, and would carry provider text into a durable record.
    const message = (err as Error)?.message ?? 'unknown'
    const stopReason: StopReason = timedOut ? 'deadline' : 'error'
    agentTrace('GENERATION_FAILED', ctx, {
      provider: handle.provider,
      steps: budget.stepsUsed(),
      timedOut,
      deadlineMs,
    })
    await input.onPersist?.({
      ...identity,
      status: 'failed',
      stopReason,
      answer: null,
      evidence: evidence.all(),
      droppedClaims: 0,
      strippedRefs: 0,
      steps: budget.stepsUsed(),
      // A stable token for a timeout: the thrown message is ours, but keeping the
      // branch means a provider string can never reach the ledger by this path.
      failureReason: timedOut ? 'wall-clock-deadline' : message,
    })
    agentTrace('INVESTIGATION_END', ctx, { ok: false, reason: stopReason })
    // Cost is 0 because the call threw before usage was reported. Tokens MAY have
    // been spent upstream; there is no honest figure available, and inventing one
    // would put a guess into a durable ledger.
    return {
      ok: false,
      reason: stopReason,
      // Never the provider's message on a timeout: the client renders by reason,
      // and a raw provider string can carry model ids and internals.
      message: timedOut ? 'deadline' : message,
      investigationId,
      costUsd: 0,
      // Tools may have executed before the provider threw; report what really ran.
      steps: budget.stepsUsed(),
      evidence: evidence.all(),
    }
  } finally {
    // Both paths, always: an uncleared timer holds the event loop, and a listener
    // left on a caller signal that outlives this run leaks across investigations.
    clearTimeout(deadlineTimer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }

  // Charge before validating: the tokens were spent whatever we do with the
  // answer, and a refused answer that bills nothing would hide real cost.
  const usage = result.totalUsage
  // Phase 1's tokens are real tokens. Billing only the answer turn would understate an
  // autonomous run and under-count the durable reservation it settles.
  const inputTokens = (usage?.inputTokens ?? 0) + (evidenceUsage?.inputTokens ?? 0)
  const outputTokens = (usage?.outputTokens ?? 0) + (evidenceUsage?.outputTokens ?? 0)
  const costUsd = estimateCostUsd(handle.modelId, inputTokens, outputTokens)
  // Interactive runs charge the shared in-memory counter, unchanged. Autonomous
  // runs deliberately do not — they hold a durable reservation and settle there.
  if (input.skipInteractiveSpend !== true) addDailySpend(scope.agencyId, costUsd)

  agentTrace('GENERATION_COMPLETE', ctx, {
    steps: budget.stepsUsed(),
    evidenceCount: evidence.size(),
    finishReason: result.finishReason,
    inputTokens,
    outputTokens,
    costUsd,
  })

  // Both paths are schema-enforced again: interactive in its single call, autonomous in
  // Phase 2. The C2 text parser is gone along with the turn that needed it.
  // `requireToolEvidence` is the autonomous path's marker; a proactive finding
  // that asserts nothing is not a finding, so a claimless answer is refused there
  // and accepted for an interactive question. See the option in ./validate.
  const validation = validateAgentAnswerDetailed(result.output as never, evidence, {
    requireClaim: input.requireToolEvidence === true,
  })
  const validated = validation.answer
  if (!validated) {
    // The rejected PROSE is still not recorded — the gate destroyed it, and
    // storing it would give an unsupported claim a second life. What is recorded
    // is why: the rule that fired and how many claims it took. Without this a
    // production refusal is indistinguishable from every other refusal, which is
    // exactly what made inv_mt7795vh_ptvevm undiagnosable.
    agentTrace('ANSWER_REJECTED', ctx, {
      evidenceCount: evidence.size(),
      rejection: validation.rejection,
      droppedClaims: validation.counts.droppedClaims,
      strippedRefs: validation.counts.strippedRefs,
      byReason: validation.counts.byReason,
    })
    await input.onPersist?.({
      ...identity,
      status: 'refused',
      stopReason: 'no_evidence',
      answer: null,
      evidence: evidence.all(),
      droppedClaims: validation.counts.droppedClaims,
      strippedRefs: validation.counts.strippedRefs,
      steps: budget.stepsUsed(),
      failureReason: validation.rejection,
    })
    agentTrace('INVESTIGATION_END', ctx, { ok: false, reason: 'no_evidence' })
    return {
      ok: false,
      reason: 'no_evidence',
      investigationId,
      costUsd,
      // The same values `onPersist` receives above. Returned so a caller that
      // persists from the result — the autonomous path — records the real run.
      steps: budget.stepsUsed(),
      evidence: evidence.all(),
      droppedClaims: validation.counts.droppedClaims,
      strippedRefs: validation.counts.strippedRefs,
      rejection: validation.rejection,
    }
  }

  // A budget stop that still produced a supportable answer is reported as the
  // budget's reason, not 'answered' — the rep is told the investigation was cut
  // short, rather than being handed a partial answer dressed as a complete one.
  const stopReason: StopReason = budget.reason() ?? 'answered'

  agentTrace('INVESTIGATION_END', ctx, {
    ok: true,
    stopReason,
    steps: budget.stepsUsed(),
    businessState: validated.businessState,
    claims: validated.claims.length,
    droppedClaims: validation.counts.droppedClaims,
    strippedRefs: validation.counts.strippedRefs,
  })

  const answer = {
    headline: validated.headline,
    claims: validated.claims,
    unknown: validated.unknown,
    businessState: validated.businessState,
  }
  await input.onPersist?.({
    ...identity,
    status: 'answered',
    stopReason,
    answer,
    evidence: evidence.all(),
    droppedClaims: validation.counts.droppedClaims,
    strippedRefs: validation.counts.strippedRefs,
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
    costUsd,
  }
}
