import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { isAiUsageLedgerEnabled } from '@/lib/flags/aiUsageLedgerFlags'
import { keepAliveUntilDone } from '@/lib/ai/lifecycle'
import { emitUsageEvent, failureReason } from '@/lib/ai/budget/events'
import { currentAiOperation } from './context'
import { PRICE_VERSION, priceUsage, type CostVerdict, type UsageTokens } from './pricing'

/**
 * Write-only AI usage ledger (`ai_usage_events`): one row per provider request.
 *
 * SAFETY CONTRACT — this runs inside AI call paths, so it:
 *   - never throws (every failure is swallowed and logged by error NAME only),
 *     so a ledger problem can never turn into a retried — re-billed — AI call;
 *   - stores identifiers and token counts only: no prompt, message, answer,
 *     phone number, error message or credential;
 *   - is idempotent per request (`callId` UNIQUE, ON CONFLICT DO NOTHING);
 *   - writes nothing unless AI_USAGE_LEDGER=1 (absence blocks);
 *   - adds at most LEDGER_WAIT_MS to the AI request path (below).
 *
 * BOUNDED WAIT. The insert starts immediately and the caller waits for it at
 * most LEDGER_WAIT_MS. If it is slower, the caller continues and the insert is
 * handed to the request lifecycle (`after()`), with its own query timeout
 * (LEDGER_QUERY_TIMEOUT_MS) — never an unbounded promise. A delayed write is
 * reported (`ledger_write_delayed`), a failed one too (`ledger_write_failed`,
 * with an error category, never its text), both on the `[ai-usage]` log line.
 *
 * REMAINING FAILURE MODE: a write still pending when the function is stopped
 * (maxDuration, crash) is lost without a failure event; the delayed event
 * already logged for it is the signal. There is no retry: a missing row is
 * missing, never invented.
 */

/** Longest the AI request path waits for the ledger insert. */
export const LEDGER_WAIT_MS = 250
/** Upper bound on the insert itself once it runs (the query is cancelled after). */
export const LEDGER_QUERY_TIMEOUT_MS = 10_000

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
  /** The billing tier the provider reported (e.g. OpenAI `service_tier`); absent = not established. */
  serviceTier?: string | null
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

/** The service tier from SDK provider metadata (any provider that reports one), or null. */
export function serviceTierFrom(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  for (const v of Object.values(meta as Record<string, unknown>)) {
    const t = (v as { serviceTier?: unknown } | null)?.serviceTier
    if (typeof t === 'string' && t) return t
  }
  return null
}

/** A short, content-free error code. Never the provider's message. */
export function errorCodeOf(err: unknown, fallback = 'error'): string {
  const name = (err as { name?: unknown })?.name
  return typeof name === 'string' && /^[A-Za-z_][\w.]{0,63}$/.test(name) ? name : fallback
}

export function newInvocationId(): string {
  return randomUUID()
}

/**
 * The cost of ONE provider request — the single pricing path shared by the
 * ledger row and the budget settlement, so the two can never disagree.
 */
export function verdictForCall(call: ProviderCall): CostVerdict {
  if (call.usage == null && call.estimatedCostUsd != null && Number.isFinite(call.estimatedCostUsd)) {
    return {
      costUsd: Math.round(call.estimatedCostUsd * 1e6) / 1e6,
      costBasis: 'estimated',
      costNote: 'duration_estimate',
      priceVersion: null,
    }
  }
  return priceUsage({ response: call.responseModel, requested: call.requestedModel }, call.usage, {
    webSearchCalls: call.webSearchCalls,
    serviceTier: call.serviceTier,
  })
}

/**
 * Several requests priced one by one (e.g. the steps of one Agent call),
 * summed only after each is priced. One unknown request makes the total
 * unknown — a partial sum is never presented as the cost.
 */
export function combineVerdicts(verdicts: readonly CostVerdict[]): CostVerdict {
  if (!verdicts.length) return { costUsd: null, costBasis: 'unknown', costNote: 'usage_missing', priceVersion: PRICE_VERSION }
  const distinct = (xs: (string | null)[]) => [...new Set(xs.flatMap((x) => (x ? x.split(',') : [])))]
  const versions = distinct(verdicts.map((v) => v.priceVersion))
  const priceVersion = versions.length ? versions.join(',') : null
  const unknown = verdicts.filter((v) => v.costBasis === 'unknown')
  if (unknown.length) {
    const costNote = [`step_cost_unknown:${unknown.length}/${verdicts.length}`, ...distinct(unknown.map((v) => v.costNote))].join(
      ',',
    )
    return { costUsd: null, costBasis: 'unknown', costNote, priceVersion }
  }
  const costUsd = Math.round(verdicts.reduce((s, v) => s + (v.costUsd ?? 0), 0) * 1e6) / 1e6
  const notes = distinct(verdicts.map((v) => v.costNote))
  return {
    costUsd,
    costBasis: verdicts.some((v) => v.costBasis === 'estimated') ? 'estimated' : 'reported_usage',
    costNote: notes.length ? notes.join(',') : null,
    priceVersion,
  }
}

function rowFor(call: ProviderCall) {
  const op = currentAiOperation()
  const verdict = verdictForCall(call)
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

/** Record one or more provider requests. Never throws; waits at most LEDGER_WAIT_MS. */
export async function recordProviderCalls(calls: ProviderCall[]): Promise<void> {
  if (!calls.length || !isAiUsageLedgerEnabled()) return
  const ids = {
    invocationId: calls[0].invocationId,
    feature: calls[0].feature,
    provider: calls[0].provider,
    agencyId: calls[0].agencyId ?? currentAiOperation()?.agencyId ?? null,
    rows: calls.length,
  }
  let write: Promise<void>
  try {
    // Rows are built now, synchronously: they read the caller's operation context.
    const rows = calls.map(rowFor)
    write = Promise.resolve(
      db('ai_usage_events').insert(rows).onConflict('callId').ignore().timeout(LEDGER_QUERY_TIMEOUT_MS, { cancel: true }),
    ).then(
      () => undefined,
      (err) =>
        emitUsageEvent('ledger_write_failed', { ...ids, stage: 'database', reason: failureReason(err, 'database'), error: err }),
    )
  } catch (err) {
    emitUsageEvent('ledger_write_failed', { ...ids, stage: 'database', reason: failureReason(err, 'database'), error: err })
    return
  }
  keepAliveUntilDone(write)
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = await Promise.race([
    write.then(() => true),
    new Promise<boolean>((r) => (timer = setTimeout(() => r(false), LEDGER_WAIT_MS))),
  ])
  clearTimeout(timer)
  if (!done) emitUsageEvent('ledger_write_delayed', { ...ids, waitedMs: LEDGER_WAIT_MS })
}

type SdkStep = {
  usage?: SdkUsage
  response?: { id?: string; modelId?: string }
  finishReason?: string
  toolCalls?: Array<{ providerExecuted?: boolean }>
  providerMetadata?: unknown
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
    serviceTier: serviceTierFrom(s.providerMetadata),
    webSearchCalls: (s.toolCalls ?? []).filter((c) => c.providerExecuted === true).length,
  }))
}
