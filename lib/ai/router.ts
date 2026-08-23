import { generateObject } from 'ai'
import type { FlexibleSchema, InferSchema } from 'ai'
import { getAiEnv } from './env'
import { hasAnyProviderConfigured, isAgencyAllowlisted, isAiEnabled } from './flags'
import { getProviderChain } from './providers'
import { estimateCostUsd, getTaskConfig } from './tasks'
import { AiRunResult, ModelRole, ProviderName, TaskKind } from './types'
import { evaluateShadowGate } from '@/lib/entitlements'
import { resolveAiAccess } from './access'
import type { CopilotModeId } from './copilotModes'
import { addDailySpend, getDailySpend } from './router/spend'
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
  const env = getAiEnv()

  if (!isAiEnabled()) return { ok: false, reason: 'disabled' }

  const allowlisted = isAgencyAllowlisted(opts.agencyId)
  const oldAllowed = opts.bypassAllowlist === true || allowlisted

  await evaluateShadowGate({
    surface: opts.bypassAllowlist === true ? 'router.runStructured.bypass' : 'router.runStructured',
    agencyId: opts.agencyId ?? null,
    oldAllowed,
    copilotModeId: opts.copilotModeId ?? null,
    taskKind: opts.kind,
    role: opts.roleOverride ?? null,
    bypassAllowlist: opts.bypassAllowlist ?? false,
  })

  if (!oldAllowed) return { ok: false, reason: 'forbidden' }

  // Product-access entitlement (Phase 2). Runs only for real agency traffic that
  // already passed the allowlist/rollout gate above. Internal bypass callers
  // (health check, offline scripts) and agency-less calls skip it — they carry
  // no subscription to evaluate. This is the server-authoritative revenue/access
  // boundary; UI state is not authorization. resolveAiAccess FAILS OPEN on any
  // read error, so a transient DB failure never denies a paying customer.
  if (opts.bypassAllowlist !== true && opts.agencyId) {
    const access = await resolveAiAccess(opts.agencyId)
    if (access.allowed === false) return { ok: false, reason: access.reason }
  }

  if (!hasAnyProviderConfigured()) return { ok: false, reason: 'no-providers' }
  if (opts.agencyId && getDailySpend(opts.agencyId) >= env.dailyUsdCap) {
    return { ok: false, reason: 'over-quota' }
  }

  const cfg = getTaskConfig(opts.kind)
  const effectiveRole = opts.roleOverride ?? cfg.role
  const chain = getProviderChain(effectiveRole, opts.kind)
  if (chain.length === 0) return { ok: false, reason: 'no-providers' }

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
