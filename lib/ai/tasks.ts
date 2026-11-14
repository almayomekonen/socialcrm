import { ModelRole, TaskKind } from './types'
import { priceFor } from './usage/pricing'

export type TaskConfig = {
  role: ModelRole
  maxOutputTokens: number
  timeoutMs: number
  retryOnSameProvider: number
  /** Interactive policy: hard wall-clock budget across all providers/attempts. Omitted = legacy (unbounded). */
  deadlineMs?: number
  /** Interactive policy: on a timeout, skip same-provider retries and fail over / fall back fast. */
  failFastOnTimeout?: boolean
  /**
   * Interactive policy: cap the provider SDK's INTERNAL retries for this task.
   * Omitted = SDK default (≈2). 0 means one call, no internal backoff — so a dead
   * provider can't burn the whole interactive deadline before the router fails over.
   */
  providerMaxRetries?: number
}

const TASKS: Record<TaskKind, TaskConfig> = {
  'lead.summary': {
    role: 'primary',
    maxOutputTokens: 600,
    timeoutMs: 8_000,
    retryOnSameProvider: 1,
  },
  'lead.classify': {
    role: 'volume',
    maxOutputTokens: 200,
    timeoutMs: 6_000,
    retryOnSameProvider: 1,
  },

  'lead.followup': {
    role: 'primary',
    maxOutputTokens: 700,
    timeoutMs: 9_000,
    retryOnSameProvider: 1,
  },

  'lead.nextStep': {
    role: 'primary',
    maxOutputTokens: 400,
    timeoutMs: 8_000,
    retryOnSameProvider: 1,
  },
  'lead.askQuestion': {
    role: 'primary',
    maxOutputTokens: 900,
    timeoutMs: 18_000,
    retryOnSameProvider: 1,
  },
  'pipeline.weekly': {
    role: 'heavy',
    maxOutputTokens: 4_000,
    timeoutMs: 30_000,
    retryOnSameProvider: 0,
  },
  'health.check': {
    role: 'primary',
    maxOutputTokens: 16,
    timeoutMs: 4_000,
    retryOnSameProvider: 0,
  },
  'copilot.classifyIntent': {
    role: 'volume',
    maxOutputTokens: 80,
    timeoutMs: 3_000,
    retryOnSameProvider: 0,
  },

  'copilot.generalReason': {
    role: 'primary',
    maxOutputTokens: 700,
    timeoutMs: 7_000,
    retryOnSameProvider: 1,
    // Interactive: a "what should I do today" answer must be fast or it's worthless.
    // Hard cap the wall-clock (legacy worst case ~33s) and don't retry a timed-out provider.
    deadlineMs: 9_000,
    failFastOnTimeout: true,
    // No SDK internal retries: a dead provider (billing/quota) must fail in one call
    // so the router fails over to a healthy provider within the deadline.
    providerMaxRetries: 0,
  },

  'conversation.analysis': {
    role: 'volume',
    maxOutputTokens: 500,
    timeoutMs: 15_000,
    retryOnSameProvider: 1,
  },

  'inbox.autoResponse': {
    role: 'primary',
    maxOutputTokens: 2_500,
    timeoutMs: 45_000,
    retryOnSameProvider: 0,
    // GPT-5.6 high reasoning is slow; one attempt, then Anthropic/Gemini failover.
    providerMaxRetries: 0,
  },

  /**
   * The Agent investigation: one multi-step tool loop answering one question.
   *
   * It does NOT run through `runStructured`, so the router-loop fields would be
   * dead config here — only `role` (which chain admission resolves),
   * `maxOutputTokens` and `providerMaxRetries` are actually read. The Agent runs
   * a SINGLE provider by design: its own step/deadline budget is the binding
   * constraint, and a fallback that re-investigates from scratch cannot fit
   * inside it. `providerMaxRetries: 0` keeps a dead provider from burning that
   * budget on SDK-internal backoff.
   *
   * `timeoutMs` matches DEFAULT_DEADLINE_MS in lib/agent/budget.ts; the budget
   * remains the authority, this is the per-call ceiling.
   */
  'agent.investigate': {
    role: 'primary',
    maxOutputTokens: 1_200,
    timeoutMs: 40_000,
    retryOnSameProvider: 0,
    providerMaxRetries: 0,
  },
}

export function getTaskConfig(kind: TaskKind): TaskConfig {
  return TASKS[kind]
}

/**
 * Price of a model not in the ledger table. Conservative on purpose: this
 * estimate feeds spend caps, where guessing low is the dangerous direction.
 */
const UNLISTED_PRICE = { input: 5, output: 15 } as const

/**
 * Estimated USD for one call, from the SAME versioned table that prices the usage
 * ledger (lib/ai/usage/pricing.ts) — there is one price table, not two.
 *
 * It drives the in-memory spend guard, the WhatsApp assistant's job cost and the
 * Agent's reported cost. Only total input/output counts reach it, so every input
 * token is priced as UNCACHED: an upper bound on the ledger's cache-aware figure,
 * never below it. (Before 2026-11-14 a second table priced gpt-5.6 at $5/$30;
 * the same jobs read ~2.9x the ledger.)
 */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model)?.price ?? UNLISTED_PRICE
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}
