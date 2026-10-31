import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { isAiUsageLedgerEnabled } from '@/lib/flags/aiUsageLedgerFlags'
import { currentAiOperation } from './context'
import { priceUsage, type UsageTokens } from './pricing'

/**
 * Write-only AI usage ledger (`ai_usage_events`): one row per provider request.
 *
 * SAFETY CONTRACT — this runs inside AI call paths, so it:
 *   - never throws (every failure is swallowed and logged by error NAME only),
 *     so a ledger problem can never turn into a retried — re-billed — AI call;
 *   - stores identifiers and token counts only: no prompt, message, answer,
 *     phone number, error message or credential;
 *   - is idempotent per request (`callId` UNIQUE, ON CONFLICT DO NOTHING);
 *   - writes nothing unless AI_USAGE_LEDGER=1 (absence blocks).
 */

export type ProviderCall = {
  callId?: string
  invocationId: string
  feature: string
  provider: string
  requestedModel: string
  responseModel?: string | null
  providerRequestId?: string | null
  chainIndex?: number
  attempt?: number
  stepIndex?: number
  status: 'success' | 'error' | 'timeout' | 'aborted'
  errorCode?: string | null
  finishReason?: string | null
  usage: (UsageTokens & { reasoningTokens?: number | null }) | null
  webSearchCalls?: number
  audioSeconds?: number | null
  /** A cost the caller already knows how to estimate when token usage is absent (e.g. audio minutes). */
  estimatedCostUsd?: number | null
  latencyMs?: number | null
  agencyId?: number | null
  userId?: number | null
  leadId?: number | null
  conversationId?: number | null
  /** The operation to record when no `withAiOperation` context is active (e.g. an Agent investigation). */
  fallbackOperation?: { kind: string; id: string }
}

type SdkUsage =
  | {
      inputTokens?: number
      outputTokens?: number
      inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
      outputTokenDetails?: { reasoningTokens?: number }
      cachedInputTokens?: number
      reasoningTokens?: number
    }
  | null
  | undefined

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

/** The AI SDK's usage object → ledger token categories. Missing stays null, never 0. */
export function usageFromSdk(u: SdkUsage): (UsageTokens & { reasoningTokens: number | null }) | null {
  if (!u || (u.inputTokens == null && u.outputTokens == null)) return null
  return {
    inputTokens: num(u.inputTokens),
    uncachedInputTokens: num(u.inputTokenDetails?.noCacheTokens),
    cachedInputTokens: num(u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens),
    cacheWriteTokens: num(u.inputTokenDetails?.cacheWriteTokens),
    outputTokens: num(u.outputTokens),
    reasoningTokens: num(u.outputTokenDetails?.reasoningTokens ?? u.reasoningTokens),
  }
}

/** A short, content-free error code. Never the provider's message. */
export function errorCodeOf(err: unknown, fallback = 'error'): string {
  const name = (err as { name?: unknown })?.name
  return typeof name === 'string' && /^[A-Za-z_][\w.]{0,63}$/.test(name) ? name : fallback
}

export function newInvocationId(): string {
  return randomUUID()
}

function rowFor(call: ProviderCall) {
  const op = currentAiOperation()
  const verdict =
    call.usage == null && call.estimatedCostUsd != null && Number.isFinite(call.estimatedCostUsd)
      ? {
          costUsd: Math.round(call.estimatedCostUsd * 1e6) / 1e6,
          costBasis: 'estimated' as const,
          costNote: 'duration_estimate',
          priceVersion: null,
        }
      : priceUsage({ response: call.responseModel, requested: call.requestedModel }, call.usage, {
          webSearchCalls: call.webSearchCalls,
        })
  return {
    callId: call.callId ?? randomUUID(),
    invocationId: call.invocationId,
    operationKind: op?.kind ?? call.fallbackOperation?.kind ?? call.feature,
    operationId: op?.id ?? call.fallbackOperation?.id ?? call.invocationId,
    agencyId: call.agencyId ?? op?.agencyId ?? null,
    userId: call.userId ?? op?.userId ?? null,
    conversationId: call.conversationId ?? op?.conversationId ?? null,
    leadId: call.leadId ?? op?.leadId ?? null,
    feature: call.feature,
    provider: call.provider,
    requestedModel: call.requestedModel,
    responseModel: call.responseModel ?? null,
    providerRequestId: call.providerRequestId ? String(call.providerRequestId).slice(0, 200) : null,
    chainIndex: call.chainIndex ?? 0,
    attempt: call.attempt ?? 0,
    stepIndex: call.stepIndex ?? 0,
    status: call.status,
    errorCode: call.errorCode ? String(call.errorCode).slice(0, 64) : null,
    finishReason: call.finishReason ?? null,
    usageReported: call.usage != null,
    inputTokens: call.usage?.inputTokens ?? null,
    uncachedInputTokens: call.usage?.uncachedInputTokens ?? null,
    cachedInputTokens: call.usage?.cachedInputTokens ?? null,
    cacheWriteTokens: call.usage?.cacheWriteTokens ?? null,
    outputTokens: call.usage?.outputTokens ?? null,
    reasoningTokens: call.usage?.reasoningTokens ?? null,
    webSearchCalls: call.webSearchCalls ?? 0,
    audioSeconds: call.audioSeconds ?? null,
    costUsd: verdict.costUsd,
    costBasis: verdict.costBasis,
    costNote: verdict.costNote,
    priceVersion: verdict.priceVersion,
    latencyMs: call.latencyMs ?? null,
  }
}

/** Record one or more provider requests. Never throws. */
export async function recordProviderCalls(calls: ProviderCall[]): Promise<void> {
  if (!calls.length || !isAiUsageLedgerEnabled()) return
  try {
    await db('ai_usage_events').insert(calls.map(rowFor)).onConflict('callId').ignore()
  } catch (err) {
    console.error('[ai-usage] ledger write failed', { name: errorCodeOf(err), calls: calls.length })
  }
}

type SdkStep = {
  usage?: SdkUsage
  response?: { id?: string; modelId?: string }
  finishReason?: string
  toolCalls?: Array<{ providerExecuted?: boolean }>
}

/** One row per generateText step: each step is its own provider request. */
export function callsFromSteps(
  steps: readonly SdkStep[] | undefined,
  base: Omit<ProviderCall, 'usage' | 'status' | 'stepIndex'>,
): ProviderCall[] {
  return (steps ?? []).map((s, i) => ({
    ...base,
    stepIndex: i,
    status: 'success' as const,
    usage: usageFromSdk(s.usage),
    responseModel: s.response?.modelId ?? base.responseModel ?? null,
    providerRequestId: s.response?.id ?? null,
    finishReason: s.finishReason ?? null,
    webSearchCalls: (s.toolCalls ?? []).filter((c) => c.providerExecuted === true).length,
  }))
}
