import 'server-only'
import { Output, generateText, stepCountIs } from 'ai'
import { admitAiRun } from '@/lib/ai/gate'
import { estimateCostUsd } from '@/lib/ai/tasks'
import { addDailySpend } from '@/lib/ai/router/spend'
import { resolveAgentScope } from './scope'
import { DEFAULT_DEADLINE_MS, DEFAULT_MAX_STEPS, createBudget } from './budget'
import { RESEARCH_DEADLINE_MS, admitsResearch } from './research/admission'
import { harvestSources, openedPageUrls, sourceManifest } from './research/harvest'
import { RESEARCH_TOOL_NAME, researchTool, providerSupportsHostedSearch } from './research/tool'
import { emptyResearchTelemetry, researchFailureReasonOf, type ResearchTelemetry } from './research/telemetry'
import { createEvidenceCollector } from './evidence'
import { buildAgentTools } from './tools'
import { createToolTimings, instrumentTools } from './instrument'
import { buildAgentSystemPrompt } from './prompt'
import { validateAgentAnswerDetailed } from './validate'
import { agentAnswerSchema } from './answerSchema'
import { agentTrace } from './trace'
import { callsFromSteps, errorCodeOf, newInvocationId, recordProviderCalls, usageFromSdk } from '@/lib/ai/usage/record'
import { newCallId, settleShadowAfter, startShadow, type ShadowHandle } from '@/lib/ai/budget/shadow'
import { estimateAgentCall } from '@/lib/ai/budget/estimate'
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
   * Never admit hosted web research, whatever the question says. The WhatsApp
   * assistant sets it: a research run takes 33-73s and costs a search, and an
   * owner asking on WhatsApp is asking about their own CRM. Omitted, research
   * admission is exactly as before.
   */
  disableResearch?: boolean
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

/**
 * ROUND TRIPS, not tool calls.
 *
 * A step in the SDK's sense is one assistant turn; the tool calls it contains
 * execute together. So two tools emitted in one turn are one wait and two calls,
 * which is exactly the difference the prompt's parallel-retrieval instruction is
 * trying to buy. `budget.stepsUsed()` counts calls and cannot see it.
 */
function countToolRoundTrips(steps: unknown): number {
  if (!Array.isArray(steps)) return 0
  return steps.filter((step) => {
    const calls = (step as { toolCalls?: unknown })?.toolCalls
    return Array.isArray(calls) && calls.length > 0
  }).length
}

function newInvestigationId(nowMs: number): string {
  return `inv_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runAgentInvestigation(input: RunAgentInput): Promise<AgentResult> {
  const now = input.now ?? (() => Date.now())
  const nowMs = now()
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  /**
   * RESEARCH IS ADMITTED BY THE APPLICATION, from the rep's own words, before any
   * tool list is built. A question that does not ask about the outside world
   * never receives the search tool — so "zero web searches on a CRM question" is
   * a property of what the model was handed, not of what it chose.
   */
  const research = input.disableResearch ? ({ admitted: false, marker: null } as const) : admitsResearch(input.question)
  /**
   * A research run gets its own wall clock. Measured hosted searches ran 33.8s
   * and 72.9s, so the 40s CRM ceiling would fail them by construction — and
   * raising that ceiling would slow every ordinary question to accommodate a
   * rarer one. An explicit caller override still wins over both.
   */
  const deadlineMs = input.deadlineMs ?? (research.admitted ? RESEARCH_DEADLINE_MS : DEFAULT_DEADLINE_MS)

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

  /**
   * REQUESTED IS NOT ADMITTED, and the gap is a real failure mode rather than a
   * bookkeeping nicety.
   *
   * `researchTool()` returns OpenAI's hosted tool. The provider chain falls back
   * to Anthropic and then Google when OpenAI is unavailable, and handing an
   * OpenAI hosted-tool definition to a different provider is not a search that
   * returns nothing — it is a malformed request. So a question that asked about
   * the outside world, on a run that failed over, is REQUESTED and NOT ADMITTED,
   * and the answer proceeds from CRM evidence alone rather than failing.
   */
  const researchAdmitted = research.admitted && providerSupportsHostedSearch(handle.provider)

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
  /**
   * Built once per investigation, so every phase of a two-phase run sees the
   * same date. Recomputing it per call would be harmless today and exactly the
   * kind of thing that stops being harmless at midnight.
   */
  const systemPrompt = buildAgentSystemPrompt(nowMs)
  const evidence = createEvidenceCollector()
  /**
   * Instrumentation only — the tools are wrapped, never altered. `now` is the
   * SAME injected clock the deadline uses, so a test with a frozen clock reports
   * a coherent zero rather than mixing two time sources.
   */
  const toolTimings = createToolTimings()
  /**
   * The nine CRM readers, instrumented — plus, only when research was admitted,
   * OpenAI's hosted web search.
   *
   * The hosted tool is NOT instrumented and NOT budgeted, because it cannot be:
   * it is provider-executed and never runs our code. Measured, seven of its
   * calls arrived inside a single SDK step, so neither `stepCountIs` nor
   * `budget.canStep` sees them. What bounds it is the wall clock above and the
   * harvest caps below — stated here rather than assumed, because a reader who
   * believes the Budget covers every tool would be wrong about this one.
   */
  const tools = {
    ...instrumentTools(buildAgentTools({ scope, evidence, budget, nowMs }), toolTimings, now),
    ...(researchAdmitted ? researchTool() : {}),
  }

  const generationStartedAt = now()
  let toolRoundTrips = 0

  /**
   * Where the wait went. `modelWaitMs` is DERIVED, not measured: the SDK owns
   * the loop, so the time not spent inside a tool is by construction time spent
   * waiting on the provider. Reported on both the success and the failure path —
   * a run that died at 40 seconds is the one where this matters most.
   */
  const timingFields = () => {
    const generationMs = now() - generationStartedAt
    const toolWallMs = toolTimings.wallMs()
    return {
      generationMs,
      modelWaitMs: Math.max(0, generationMs - toolWallMs),
      toolWallMs,
      toolSumMs: toolTimings.sumMs(),
      toolCalls: toolTimings.calls(),
      toolRoundTrips,
    }
  }

  let result
  /** Phase 1's token usage, folded into the cost so a two-phase run bills honestly. */
  let evidenceUsage: { inputTokens?: number; outputTokens?: number } | undefined
  /**
   * Usage ledger: every generateText STEP is its own provider request, so each
   * is one row; both phases share one invocation. Write-only, never throws.
   */
  const ledger = {
    invocationId: newInvocationId(),
    feature: AGENT_TASK_KIND,
    provider: handle.provider,
    requestedModel: handle.modelId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    fallbackOperation: { kind: 'agent_investigation', id: investigationId },
  }
  let ledgerSteps = 0
  const recordSteps = async (steps: Parameters<typeof callsFromSteps>[0]) => {
    const calls = callsFromSteps(steps, ledger).map((c) => ({ ...c, stepIndex: ledgerSteps + (c.stepIndex ?? 0) }))
    ledgerSteps += calls.length
    await recordProviderCalls(calls)
  }
  /**
   * Budget SHADOW: one reservation per generateText call (each may run several
   * steps). Started, not awaited, immediately before the call; settled after
   * it with the call's total usage. The bound is PARTIAL — later tool results
   * are unknown in advance. Never delays, blocks or changes the call.
   */
  let pendingShadow: ShadowHandle | null = null
  const reserveCall = (messages: unknown, steps: number): ShadowHandle =>
    startShadow({
      callId: newCallId(),
      agencyId: scope.agencyId,
      feature: AGENT_TASK_KIND,
      provider: handle.provider,
      model: handle.modelId,
      estimate: (policy) =>
        estimateAgentCall({
          model: handle.modelId,
          system: systemPrompt,
          messages,
          maxSteps: steps,
          maxOutputTokens: cfg.maxOutputTokens ?? 0,
          maxSearchCalls: researchAdmitted ? 7 * steps : 0,
          unboundedReserveUsd: policy.unboundedReserveUsd,
        }),
    })
  const settleCall = async (outcome: 'success' | 'error', usage: unknown, steps?: readonly { response?: { modelId?: string }; toolCalls?: { providerExecuted?: boolean }[] }[]) => {
    if (!pendingShadow) return
    const h = pendingShadow
    pendingShadow = null
    await settleShadowAfter(h, {
      outcome,
      usage: usageFromSdk(usage as Parameters<typeof usageFromSdk>[0]),
      models: { requested: handle.modelId, response: steps?.at(-1)?.response?.modelId ?? null },
      webSearchCalls: (steps ?? []).reduce((n, st) => n + (st.toolCalls ?? []).filter((c) => c.providerExecuted === true).length, 0),
    })
  }
  /**
   * PROVIDER-RESOURCE ACCOUNTING, kept deliberately apart from `Budget`.
   *
   * The Budget counts calls that ran our code; none of these did. Every number
   * here is read from the provider's own response — see ./research/telemetry.ts
   * for why deriving them from `stepsUsed()` would be fiction. Counts only: never
   * a snippet, so a trace line cannot become a place page content is stored.
   */
  let researchTelemetry: ResearchTelemetry = {
    ...emptyResearchTelemetry(deadlineMs),
    researchRequested: research.admitted,
    researchAdmitted,
    // Overwritten by the harvest on an admitted run. Standing value covers the
    // two cases the harvest never reaches: never asked, and asked on a provider
    // that cannot search.
    researchFailureReason: researchFailureReasonOf({
      researchRequested: research.admitted,
      researchAdmitted,
      hostedSearchCalls: 0,
      rawSourceRecords: 0,
      admittedSources: 0,
    }),
  }
  try {
    /**
     * TWO PHASES FOR RESEARCH TOO, and for the same reason the autonomous path
     * needs them: one Responses turn is either schema-enforced or tool-driven,
     * never both. The autonomous path hit that with `tool_choice: required`;
     * hosted web search hits it from the other side — measured, a search turn
     * finishes with plain prose, and asking the same turn for structured output
     * produced `malformed` every time. Gathering and answering separate, exactly
     * as they already do.
     */
    if (input.requireToolEvidence === true || researchAdmitted) {
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
      // The hosted search runs INSIDE this call, so this span is the research
      // wall clock — there is no narrower boundary we can observe.
      const phase1StartedAt = now()
      pendingShadow = reserveCall(conversation, maxSteps)
      const evidencePhase = await generateText({
        model: handle.model,
        system: systemPrompt,
        messages: conversation,
        tools,
        stopWhen: stepCountIs(maxSteps),
        /**
         * The gate lifts on the first EXECUTED tool — `budget.stepsUsed()` is the same
         * counter `steps` reports, so the gate and the audit cannot disagree.
         *
         * A HOSTED CALL ALSO LIFTS IT, and must. Provider-executed searches never
         * reach the Budget, so on a research run `stepsUsed()` stays 0 no matter how
         * much work happened — and the gate would force another tool call on every
         * step until the ceiling, turning one search into six.
         */
        prepareStep: (opts) => {
          // Defensive destructure: the SDK always supplies `steps`, and the wire
          // tests call this with no argument to sample the required→auto flip.
          const steps = opts?.steps ?? []
          const hostedCallMade = steps.some((st) => (st.toolCalls ?? []).some((c) => c.providerExecuted === true))
          return { toolChoice: budget.stepsUsed() === 0 && !hostedCallMade ? ('required' as const) : ('auto' as const) }
        },
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
      evidenceUsage = evidencePhase.totalUsage
      toolRoundTrips = countToolRoundTrips(evidencePhase.steps)
      await recordSteps(evidencePhase.steps)
      await settleCall('success', evidencePhase.totalUsage, evidencePhase.steps)

      /**
       * ── THE HARVEST SEAM ──────────────────────────────────────────────────
       *
       * The one place a source can become citable, and it is here for a reason:
       * Phase 1 has finished gathering and Phase 2 has not started answering, so
       * this is the moment the collector holds everything the run actually saw
       * and nothing the model has yet claimed about it.
       *
       * Evidence is derived from TWO provider records, never from the model's
       * prose: `evidencePhase.sources` (pages the model CITED, via
       * `url_citation`) and the `openPage` actions in `evidencePhase.toolResults`
       * (pages the provider actually FETCHED). A URL printed on a web page still
       * cannot become a citation — the model can only cite refIds minted here.
       *
       * SEARCH-ENGINE HITS ARE NOT AMONG THEM. `action.sources` carries 12-20
       * results per call that the model may never have opened; admitting one
       * would assert a source for a page nobody read. See ./harvest.ts.
       *
       * Nothing is created if the search never ran. No citations and no opened
       * pages harvests nothing, the collector gains nothing, and every SOURCED
       * claim the model might attempt is dropped by the validator as
       * unsupported — a failed search cannot become a fabricated answer.
       */
      if (researchAdmitted) {
        const harvest = harvestSources(evidencePhase.sources as never, {
          retrievedAt: new Date(nowMs).toISOString(),
          opened: openedPageUrls(evidencePhase.toolResults as never),
        })
        for (const ref of harvest.refs) evidence.add(ref)

        /**
         * COUNTED FROM THE PROVIDER, never from the step counter. Each hosted
         * call is a `toolCall` the provider reports; measured, seven of them can
         * arrive inside one SDK step, which is exactly why `stepsUsed()` cannot
         * stand in for this number.
         */
        const hostedSearchCalls = evidencePhase.steps.reduce(
          (n, st) => n + (st.toolCalls ?? []).filter((c) => c.toolName === RESEARCH_TOOL_NAME).length,
          0,
        )
        researchTelemetry = {
          researchRequested: research.admitted,
          researchAdmitted: true,
          hostedSearchCalls,
          rawSourceRecords: harvest.rawRecords,
          uniqueSources: harvest.unique,
          admittedSources: harvest.refs.length,
          rejectedSources: harvest.cappedOut + harvest.unusable,
          sourcesByDomain: harvest.byDomain,
          researchWallMs: now() - phase1StartedAt,
          researchDeadlineMs: deadlineMs,
          researchHarvested: harvest.refs.length > 0,
          groundedSourcedClaims: 0, // filled after validation; unknown here
          researchFailureReason: researchFailureReasonOf({
            researchRequested: research.admitted,
            researchAdmitted: true,
            hostedSearchCalls,
            rawSourceRecords: harvest.rawRecords,
            admittedSources: harvest.refs.length,
          }),
        }
        agentTrace('RESEARCH_HARVEST', ctx, { marker: research.marker, ...researchTelemetry })
      }

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
      const answerMessages = [...conversation, ...evidencePhase.response.messages, ...sourceManifest(evidence)]
      pendingShadow = reserveCall(answerMessages, 1)
      result = await generateText({
        model: handle.model,
        system: systemPrompt,
        messages: answerMessages,
        output: Output.object({ schema: agentAnswerSchema }),
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
      await recordSteps(result.steps)
      await settleCall('success', result.totalUsage, result.steps)
    } else {
      // ── INTERACTIVE · unchanged: one call, tools, structured output. ──
      pendingShadow = reserveCall(conversation, maxSteps)
      result = await generateText({
        model: handle.model,
        system: systemPrompt,
        messages: conversation,
        tools,
        stopWhen: stepCountIs(maxSteps),
        output: Output.object({ schema: agentAnswerSchema }),
        maxOutputTokens: cfg.maxOutputTokens,
        abortSignal: runSignal,
        ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
      })
      toolRoundTrips = countToolRoundTrips(result.steps)
      await recordSteps(result.steps)
      await settleCall('success', result.totalUsage, result.steps)
    }
  } catch (err) {
    await settleCall('error', (err as { usage?: unknown })?.usage)
    // The request that threw: its steps are unknown, so its usage is unknown —
    // recorded as such, never as zero.
    await recordProviderCalls([
      {
        ...ledger,
        stepIndex: ledgerSteps,
        status: timedOut ? 'timeout' : callerSignal?.aborted ? 'aborted' : 'error',
        errorCode: timedOut ? 'deadline' : errorCodeOf(err),
        usage: usageFromSdk((err as { usage?: Parameters<typeof usageFromSdk>[0] })?.usage),
      },
    ])
    // A deadline abort and a provider failure arrive through the same throw, so
    // the flag set by the timer is what tells them apart — the error's own
    // message cannot, and would carry provider text into a durable record.
    const message = (err as Error)?.message ?? 'unknown'
    const stopReason: StopReason = timedOut ? 'deadline' : 'error'
    /**
     * A research run that died mid-flight must say WHY in its own terms. Without
     * this the telemetry would report `no-searches` — indistinguishable from a
     * model that simply chose not to search, which is the opposite diagnosis.
     */
    if (researchTelemetry.researchAdmitted) {
      researchTelemetry = {
        ...researchTelemetry,
        researchFailureReason: timedOut ? 'deadline' : 'provider-error',
      }
    }
    agentTrace('GENERATION_FAILED', ctx, {
      provider: handle.provider,
      steps: budget.stepsUsed(),
      timedOut,
      deadlineMs,
      ...timingFields(),
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
    ...researchTelemetry,
    finishReason: result.finishReason,
    inputTokens,
    outputTokens,
    costUsd,
    ...timingFields(),
  })

  const validationStartedAt = now()

  // Both paths are schema-enforced again: interactive in its single call, autonomous in
  // Phase 2. The C2 text parser is gone along with the turn that needed it.
  // `requireToolEvidence` is the autonomous path's marker; a proactive finding
  // that asserts nothing is not a finding, so a claimless answer is refused there
  // and accepted for an interactive question. See the option in ./validate.
  /**
   * `result.output` THROWS rather than returning null when the model produced no
   * structured payload — `finishReason: 'length'`, the output budget spent on
   * reasoning before the schema was ever emitted. It is a GETTER, and it is read
   * here, past the try/catch that guards generation, so the throw escaped
   * `runAgentInvestigation` entirely: the caller got an exception instead of a
   * result, nothing was persisted, and the rep saw a generic error for a run that
   * had already been paid for.
   *
   * Observed on question D7 of the Phase 3a evaluation — 13,269 input tokens,
   * 1,367 output tokens, `finishReason: 'length'`, no payload, and the whole
   * 40-question run died on it.
   *
   * Reading it defensively turns that into an outcome the system already has a
   * name for. `undefined` fails `isWellFormed`, so the validator refuses it as
   * `malformed` and the existing rejection path persists, traces and returns it
   * exactly like any other refusal. Nothing is repaired and nothing is invented;
   * the run is simply reported as having produced no usable answer.
   */
  let proposed: unknown
  try {
    proposed = result.output
  } catch {
    proposed = undefined
  }

  const validation = validateAgentAnswerDetailed(proposed as never, evidence, {
    requireClaim: input.requireToolEvidence === true,
  })
  const validationMs = now() - validationStartedAt
  const validated = validation.answer
  if (!validated) {
    // The rejected PROSE is still not recorded — the gate destroyed it, and
    // storing it would give an unsupported claim a second life. What is recorded
    // is why: the rule that fired and how many claims it took. Without this a
    // production refusal is indistinguishable from every other refusal, which is
    // exactly what made inv_mt7795vh_ptvevm undiagnosable.
    /**
     * THE DIAGNOSTIC RECORD FOR A REFUSAL, and every field in it is metadata.
     *
     * The rejected prose is still destroyed and still never written anywhere —
     * that is the point of the gate. What is recorded is the SHAPE of the
     * failure: which rule fired (`RULE_17`), how much the model proposed, how
     * much survived, how generation ended, and how much evidence it had. A live
     * evaluation refused two answers on two different questions and neither
     * could be classified afterwards, because `unsupported-claim` is the same
     * string for twenty-six different problems.
     *
     * `rejectionRuleId` names OUR blocklist phrase, never the user's text.
     */
    agentTrace('ANSWER_REJECTED', ctx, {
      evidenceCount: evidence.size(),
      rejection: validation.rejection,
      rejectionRuleId: validation.rejectionRuleId,
      proposedClaims: validation.counts.proposedClaims,
      droppedClaims: validation.counts.droppedClaims,
      strippedRefs: validation.counts.strippedRefs,
      byReason: validation.counts.byReason,
      finishReason: result.finishReason,
      steps: budget.stepsUsed(),
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
      // Durable and diagnosable: `unsupported-claim/RULE_17`, not just
      // `unsupported-claim`. Still carries none of the destroyed prose.
      failureReason: validation.rejectionRuleId
        ? `${validation.rejection}/${validation.rejectionRuleId}`
        : validation.rejection,
    })
    agentTrace('INVESTIGATION_END', ctx, {
      ok: false,
      reason: 'no_evidence',
      validationMs,
      totalMs: now() - nowMs,
    })
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
      rejectionRuleId: validation.rejectionRuleId,
    }
  }

  // A budget stop that still produced a supportable answer is reported as the
  // budget's reason, not 'answered' — the rep is told the investigation was cut
  // short, rather than being handed a partial answer dressed as a complete one.
  const stopReason: StopReason = budget.reason() ?? 'answered'

  /**
   * THE ONE LINE THAT ANSWERS "how did this research answer happen?".
   *
   * Emitted after validation, which is the earliest point the last field is
   * knowable: `GENERATION_COMPLETE` fires before the claim gate has run, so the
   * number of SOURCED claims that actually SURVIVED cannot be reported there.
   *
   * That number is the one worth having. Sources admitted with zero grounded
   * claims means the search worked and the answer did not use it — a different
   * problem from a search that found nothing, and invisible without this pair.
   */
  if (researchTelemetry.researchRequested) {
    researchTelemetry = {
      ...researchTelemetry,
      groundedSourcedClaims: validated.claims.filter((c) => c.claimClass === 'SOURCED').length,
    }
    agentTrace('RESEARCH_COMPLETE', ctx, researchTelemetry)
  }

  agentTrace('INVESTIGATION_END', ctx, {
    ok: true,
    stopReason,
    steps: budget.stepsUsed(),
    businessState: validated.businessState,
    claims: validated.claims.length,
    droppedClaims: validation.counts.droppedClaims,
    strippedRefs: validation.counts.strippedRefs,
    validationMs,
    totalMs: now() - nowMs,
  })

  const answer = {
    headline: validated.headline,
    claims: validated.claims,
    unknown: validated.unknown,
    businessState: validated.businessState,
    /**
     * A REQUEST, carried out of the loop unexecuted. `runAgentInvestigation`
     * does not run actions and must not start: it holds the model's single
     * deadline and its evidence gate, and an execution inside it would be a
     * mutation racing a wall clock. The caller hands this to the Action Runtime,
     * which has its own decisions to make about it.
     */
    proposedAction: validated.proposedAction,
    /** Same contract as `proposedAction`: a request, carried out unexecuted. */
    proposedBatch: validated.proposedBatch,
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
