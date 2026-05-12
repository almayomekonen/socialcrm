import { generateObject } from 'ai'
import type { FlexibleSchema, InferSchema, ModelMessage } from 'ai'
import { getAiEnv } from './env'
import { hasAnyProviderConfigured, isAgencyAllowlisted, isAiEnabled } from './flags'
import { logAiRequest } from './logger'
import { getProviderChain } from './providers'
import { estimateCostUsd, getTaskConfig } from './tasks'
import { AiRunResult, ModelRole, ProviderName, TaskKind } from './types'

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
  /**
   * Optional override for the provider chain role. Used by surfaces that
   * expose user-selectable AI modes (Copilot composer) without leaking the
   * underlying provider/model identifiers. The task's default role from
   * `getTaskConfig(kind).role` is used when this is undefined.
   */
  roleOverride?: ModelRole
}

export type RunStructuredImageAttachment = {
  url: string
  mediaType: string
  name?: string | null
}

type DailyEntry = { dateUtc: string; usd: number }
const dailySpend = new Map<number, DailyEntry>()

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function getDailySpend(agencyId: number): number {
  const e = dailySpend.get(agencyId)
  if (!e) return 0
  if (e.dateUtc !== todayUtc()) {
    dailySpend.delete(agencyId)
    return 0
  }
  return e.usd
}

function addDailySpend(agencyId: number, usd: number) {
  const today = todayUtc()
  const e = dailySpend.get(agencyId)
  if (!e || e.dateUtc !== today) dailySpend.set(agencyId, { dateUtc: today, usd })
  else e.usd += usd
}

export async function runStructured<S extends FlexibleSchema<unknown>>(
  opts: RunStructuredOptions<S>,
): Promise<AiRunResult<InferSchema<S>>> {
  const startedAt = Date.now()
  const env = getAiEnv()

  if (!isAiEnabled()) {
    return { ok: false, reason: 'disabled' }
  }

  if (!opts.bypassAllowlist && !isAgencyAllowlisted(opts.agencyId)) {
    return { ok: false, reason: 'forbidden' }
  }

  if (!hasAnyProviderConfigured()) {
    return { ok: false, reason: 'no-providers' }
  }

  if (opts.agencyId && getDailySpend(opts.agencyId) >= env.dailyUsdCap) {
    return { ok: false, reason: 'over-quota' }
  }

  const cfg = getTaskConfig(opts.kind)
  const effectiveRole = opts.roleOverride ?? cfg.role
  const chain = getProviderChain(effectiveRole)
  if (chain.length === 0) {
    return { ok: false, reason: 'no-providers' }
  }

  let lastErrorMessage: string | undefined
  let lastErrorCode: string | undefined
  // TEMPORARY: tracks the previous provider so [FALLBACK] can be emitted when
  // the chain advances. Remove with the AI_TRACE block below after audit.
  let previousProvider: ProviderName | null = null
  const aiTrace = process.env.AI_TRACE === '1'

  for (const handle of chain) {
    if (aiTrace && previousProvider !== null && previousProvider !== handle.provider) {
      // TEMPORARY [FALLBACK] — chain advanced past the previous provider.
      console.warn(
        '[FALLBACK]',
        JSON.stringify({
          kind: opts.kind,
          role: effectiveRole,
          from: previousProvider,
          to: handle.provider,
          toModel: handle.modelId,
          reason: lastErrorCode ?? 'unknown',
          message: lastErrorMessage,
        }),
      )
    }
    const attempts = cfg.retryOnSameProvider + 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      const callStartedAt = Date.now()
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

        logAiRequest({
          userId: opts.userId ?? null,
          agencyId: opts.agencyId ?? null,
          leadId: opts.leadId ?? null,
          taskKind: opts.kind,
          provider: handle.provider as ProviderName,
          model: handle.modelId,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs,
          success: true,
          errorCode: null,
        })

        if (aiTrace) {
          // TEMPORARY [AI ROUTER] — successful attempt resolution.
          console.info(
            '[AI ROUTER]',
            JSON.stringify({
              kind: opts.kind,
              role: effectiveRole,
              provider: handle.provider,
              model: handle.modelId,
              attempt,
              latencyMs,
              fallbackUsed: previousProvider !== null && previousProvider !== handle.provider,
              success: true,
            }),
          )
        }

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
        lastErrorMessage = message
        const errorCode = classifyError(err)
        lastErrorCode = errorCode

        console.warn(
          `[ai] router.call.fail provider=${handle.provider} model=${handle.modelId} attempt=${attempt} code=${errorCode} msg=${message}`,
        )

        if (aiTrace) {
          // TEMPORARY [AI ROUTER] — failed attempt before retry/fallback.
          console.warn(
            '[AI ROUTER]',
            JSON.stringify({
              kind: opts.kind,
              role: effectiveRole,
              provider: handle.provider,
              model: handle.modelId,
              attempt,
              latencyMs: Date.now() - callStartedAt,
              fallbackUsed: previousProvider !== null && previousProvider !== handle.provider,
              success: false,
              errorCode,
              message,
            }),
          )
        }
        logAiRequest({
          userId: opts.userId ?? null,
          agencyId: opts.agencyId ?? null,
          leadId: opts.leadId ?? null,
          taskKind: opts.kind,
          provider: handle.provider as ProviderName,
          model: handle.modelId,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - callStartedAt,
          success: false,
          errorCode,
        })
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

function buildPrompt(
  user: string,
  images: RunStructuredImageAttachment[] | undefined,
): { prompt: string } | { messages: ModelMessage[] } {
  const validImages = (images ?? []).filter((image) => isHttpUrl(image.url))
  if (validImages.length === 0) return { prompt: user }

  const content: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: user },
        ...validImages.map((image) => ({
          type: 'image' as const,
          image: new URL(image.url),
          mediaType: image.mediaType,
        })),
      ],
    },
  ]

  return { messages: content }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function classifyError(err: unknown): string {
  const msg = ((err as Error)?.message ?? '').toLowerCase()
  if (msg.includes('abort') || msg.includes('timeout')) return 'timeout'
  if (msg.includes('rate') && msg.includes('limit')) return 'rate-limit'
  if (msg.includes('401') || msg.includes('unauthor')) return 'auth'
  if (msg.includes('400')) return 'bad-request'
  if (msg.includes('5')) return 'server-error'
  return 'unknown'
}

export function _resetDailySpendForTests() {
  dailySpend.clear()
}
