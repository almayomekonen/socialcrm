import { generateObject } from 'ai'
import type { FlexibleSchema, InferSchema } from 'ai'
import { getAiEnv } from './env'
import { hasAnyProviderConfigured, isAgencyAllowlisted, isAiEnabled } from './flags'
import { getProviderChain } from './providers'
import { estimateCostUsd, getTaskConfig } from './tasks'
import { AiRunResult, ModelRole, ProviderName, TaskKind } from './types'
import { evaluateShadowGate } from '@/lib/entitlements'
import type { CopilotModeId } from './copilotModes'
import { addDailySpend, getDailySpend } from './router/spend'
import { buildPrompt } from './router/promptBuilder'
import { classifyError } from './router/errorClassify'
import { logAttemptFailure, logAttemptSuccess, logFallbackTrace } from './router/attemptLogger'

export { _resetDailySpendForTests } from './router/spend'

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

  // OLD production gate. Phase B observes — does NOT replace — this decision.
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
  if (!hasAnyProviderConfigured()) return { ok: false, reason: 'no-providers' }
  if (opts.agencyId && getDailySpend(opts.agencyId) >= env.dailyUsdCap) {
    return { ok: false, reason: 'over-quota' }
  }

  const cfg = getTaskConfig(opts.kind)
  const effectiveRole = opts.roleOverride ?? cfg.role
  const chain = getProviderChain(effectiveRole)
  if (chain.length === 0) return { ok: false, reason: 'no-providers' }

  let lastErrorMessage: string | undefined
  let lastErrorCode: string | undefined
  let previousProvider: ProviderName | null = null

  for (const handle of chain) {
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
          abortSignal: AbortSignal.timeout(cfg.timeoutMs),
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
