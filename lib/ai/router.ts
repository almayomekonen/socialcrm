import { generateObject } from 'ai'
import type { FlexibleSchema, InferSchema } from 'ai'
import { getAiEnv } from './env'
import { estimateCostUsd } from './tasks'
import { AiRunResult, ModelRole, ProviderName, TaskKind } from './types'
import { admitAiRun } from './gate'
import type { CopilotModeId } from './copilotModes'
import { addDailySpend } from './router/spend'
import { buildPrompt } from './router/promptBuilder'
import { classifyError, isPermanentError } from './router/errorClassify'
import { logAttemptFailure, logAttemptSuccess, logFallbackTrace } from './router/attemptLogger'
import { attemptBudget, skipRetryOnTimeout } from './router/interactivePolicy'
import {
  newInvocationId,
  recordProviderCalls,
  serviceTierFrom,
  usageFromSdk,
  verdictForCall,
  type ProviderCall,
} from './usage/record'
import { newCallId, settleShadowAfter, startShadow } from './budget/shadow'
import { estimateStructuredRequest } from './budget/estimate'
import { schemaBytes } from './budget/requestSize'

export { _resetDailySpendForTests } from './router/spend'

/**
 * Timeout + caller cancellation as one signal. `AbortSignal.any` exists on every
 * runtime this app ships to; the manual fallback keeps an older/exotic runtime
 * from losing the timeout entirely.
 */
function combineAbortSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  if (!caller) return timeout
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof any === 'function') return any([timeout, caller])
  const controller = new AbortController()
  const forward = (s: AbortSignal) => {
    if (s.aborted) controller.abort(s.reason)
    else s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  forward(timeout)
  forward(caller)
  return controller.signal
}

function ireOpenAiCallOptions(
  kind: TaskKind,
  provider: ProviderName,
  modelId: string,
): { providerOptions?: { openai: { reasoningEffort: string } } } {
  if (kind !== 'inbox.autoResponse' || provider !== 'openai') return {}
  if (!/^gpt-5/i.test(modelId)) return {}
  const effort = getAiEnv().openai?.ireReasoningEffort ?? 'high'
  return { providerOptions: { openai: { reasoningEffort: effort } } }
}

export type RunStructuredOptions<S extends FlexibleSchema<unknown>> = {
  kind: TaskKind
  schema: S
  schemaName?: string
  schemaDescription?: string
  system: string
  user: string
  images?: RunStructuredImageAttachment[]
  userId?: number | null
  agencyId?: number | null
  leadId?: number | null
  bypassAllowlist?: boolean
  roleOverride?: ModelRole
  copilotModeId?: CopilotModeId
  /**
   * Caller-owned cancellation, combined with (never replacing) the per-attempt
   * interactive timeout. Used by the WhatsApp Agent to abandon a generation the
   * moment a human rep starts typing — see lib/inbox/autoresponse/humanPresenceWatch.ts.
   */
  abortSignal?: AbortSignal
}

export type RunStructuredImageAttachment = {
  url: string
  mediaType: string
  name?: string | null
}

export async function runStructured<S extends FlexibleSchema<unknown>>(
  opts: RunStructuredOptions<S>,
): Promise<AiRunResult<InferSchema<S>>> {
  const startedAt = Date.now()

  // Admission — env, allowlist, shadow telemetry, entitlement, providers, spend
  // cap, and model resolution, in that exact order. See lib/ai/gate.ts.
  const admission = await admitAiRun({
    kind: opts.kind,
    agencyId: opts.agencyId,
    bypassAllowlist: opts.bypassAllowlist,
    roleOverride: opts.roleOverride,
    copilotModeId: opts.copilotModeId,
  })
  if (admission.ok === false) return { ok: false, reason: admission.reason }
  const { cfg, effectiveRole, chain } = admission

  let lastErrorMessage: string | undefined
  let lastErrorCode: string | undefined
  let previousProvider: ProviderName | null = null
  // Usage ledger: every attempt below (retries and fallbacks included) is one
  // provider request under this one invocation.
  const invocationId = newInvocationId()
  let chainIndex = -1
  let ledgerHandle = chain[0]
  const ledgerBase = (ci: number, attempt: number) => ({
    invocationId,
    feature: opts.kind,
    provider: ledgerHandle.provider,
    requestedModel: ledgerHandle.modelId,
    chainIndex: ci,
    attempt,
    agencyId: opts.agencyId ?? null,
    userId: opts.userId ?? null,
    leadId: opts.leadId ?? null,
  })

  providerLoop: for (const handle of chain) {
    chainIndex++
    ledgerHandle = handle
    if (previousProvider !== null && previousProvider !== handle.provider) {
      logFallbackTrace({
        kind: opts.kind,
        effectiveRole,
        from: previousProvider,
        to: handle.provider as ProviderName,
        toModel: handle.modelId,
        reason: lastErrorCode,
        message: lastErrorMessage,
      })
    }

    const attempts = cfg.retryOnSameProvider + 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      const budget = attemptBudget(cfg, startedAt, Date.now())
      if (budget.stop) {
        lastErrorCode = lastErrorCode ?? 'timeout'
        lastErrorMessage = lastErrorMessage ?? 'interactive deadline exceeded'
        break providerLoop
      }
      const callStartedAt = Date.now()
      const commonCtx = {
        kind: opts.kind,
        userId: opts.userId ?? null,
        agencyId: opts.agencyId ?? null,
        leadId: opts.leadId ?? null,
        provider: handle.provider as ProviderName,
        model: handle.modelId,
        attempt,
        effectiveRole,
        fallbackUsed: previousProvider !== null && previousProvider !== handle.provider,
        callStartedAt,
      }
      // Budget SHADOW: reserve a bounded estimate for THIS attempt. Not awaited —
      // the provider request below is never delayed, blocked or changed by it.
      const callId = newCallId()
      const shadow = startShadow({
        callId,
        agencyId: opts.agencyId ?? null,
        leadId: opts.leadId ?? null,
        feature: opts.kind,
        provider: handle.provider,
        model: handle.modelId,
        invocationId,
        // Every attempt and fallback of this call is one run (the ledger's operation too).
        run: { kind: opts.kind, id: invocationId },
        estimate: async (policy) =>
          estimateStructuredRequest({
            model: handle.modelId,
            system: opts.system,
            user: opts.user,
            schemaBytes: await schemaBytes(opts.schema as FlexibleSchema<unknown>),
            schemaName: opts.schemaName,
            schemaDescription: opts.schemaDescription,
            imageCount: opts.images?.length ?? 0,
            maxOutputTokens: cfg.maxOutputTokens,
            unboundedReserveUsd: policy.unboundedReserveUsd,
          }),
      })

      try {
        const prompt = buildPrompt(opts.user, opts.images)
        const result = await generateObject({
          model: handle.model,
          output: 'object',
          schema: opts.schema as FlexibleSchema<unknown>,
          schemaName: opts.schemaName,
          schemaDescription: opts.schemaDescription,
          system: opts.system,
          ...prompt,
          maxOutputTokens: cfg.maxOutputTokens,
          abortSignal: combineAbortSignals(AbortSignal.timeout(budget.timeoutMs), opts.abortSignal),
          ...(cfg.providerMaxRetries != null ? { maxRetries: cfg.providerMaxRetries } : {}),
          ...ireOpenAiCallOptions(opts.kind, handle.provider, handle.modelId),
        })

        const latencyMs = Date.now() - callStartedAt
        const inputTokens = result.usage?.inputTokens ?? 0
        const outputTokens = result.usage?.outputTokens ?? 0
        const costUsd = estimateCostUsd(handle.modelId, inputTokens, outputTokens)
        if (opts.agencyId) addDailySpend(opts.agencyId, costUsd)

        logAttemptSuccess({ ...commonCtx, inputTokens, outputTokens, costUsd, latencyMs })
        const usage = usageFromSdk(result.usage)
        const responseModel = result.response?.modelId ?? null
        const ledgerCall: ProviderCall = {
          ...ledgerBase(chainIndex, attempt),
          callId,
          status: 'success',
          usage,
          responseModel,
          providerRequestId: result.response?.id ?? null,
          finishReason: result.finishReason ?? null,
          serviceTier: serviceTierFrom(result.providerMetadata),
          latencyMs,
        }
        await recordProviderCalls([ledgerCall])
        await settleShadowAfter(shadow, {
          outcome: 'success',
          usage,
          models: { requested: handle.modelId, response: responseModel },
          verdict: verdictForCall(ledgerCall),
          stepIndexFrom: 0,
          stepCount: 1,
        })

        return {
          ok: true,
          data: result.object as InferSchema<S>,
          provider: handle.provider as ProviderName,
          model: handle.modelId,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs,
        }
      } catch (err) {
        const message = (err as Error)?.message ?? 'unknown'
        const errorCode = classifyError(err)
        lastErrorMessage = message
        lastErrorCode = errorCode

        logAttemptFailure({ ...commonCtx, errorCode, message, err })
        // A schema failure (NoObjectGeneratedError) still carries the usage the
        // provider billed; a timeout or abort usually carries none (→ unknown cost).
        const failed = err as {
          usage?: Parameters<typeof usageFromSdk>[0]
          response?: { id?: string; modelId?: string }
          finishReason?: string
        }
        const failedUsage = usageFromSdk(failed?.usage)
        const failedCall: ProviderCall = {
          ...ledgerBase(chainIndex, attempt),
          callId,
          status: errorCode === 'timeout' ? (opts.abortSignal?.aborted ? 'aborted' : 'timeout') : 'error',
          errorCode,
          usage: failedUsage,
          responseModel: failed?.response?.modelId ?? null,
          providerRequestId: failed?.response?.id ?? null,
          finishReason: failed?.finishReason ?? null,
          latencyMs: Date.now() - callStartedAt,
        }
        await recordProviderCalls([failedCall])
        await settleShadowAfter(shadow, {
          outcome: 'error',
          usage: failedUsage,
          models: { requested: handle.modelId, response: failedCall.responseModel },
          verdict: verdictForCall(failedCall),
          stepIndexFrom: 0,
          stepCount: 1,
        })
        if (isPermanentError(errorCode)) break
        if (skipRetryOnTimeout(cfg, errorCode)) break
        if (attempt === attempts - 1) break
      }
    }
    previousProvider = handle.provider as ProviderName
  }

  return {
    ok: false,
    reason: 'all-providers-failed',
    message: lastErrorMessage,
    latencyMs: Date.now() - startedAt,
  }
}
