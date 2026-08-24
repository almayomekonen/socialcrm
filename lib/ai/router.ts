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

  providerLoop: for (const handle of chain) {
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
