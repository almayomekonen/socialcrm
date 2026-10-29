/**
 * Versioned provider prices for the AI usage ledger (USD per 1M tokens).
 *
 * Separate from `estimateCostUsd` (lib/ai/tasks.ts), which still drives the
 * in-memory spend cap and is deliberately untouched: this table only prices
 * ledger rows. A model that is not listed here is NOT guessed — its rows are
 * recorded with `costBasis: 'unknown'`. In particular plain `gpt-5.6` (the
 * code's default id) is absent because OpenAI's price page lists only the
 * `gpt-5.6-sol/-terra/-luna` variants; the provider-reported response model
 * is priced first, so a request that OpenAI serves as `gpt-5.6-sol` is priced.
 *
 * Sources, checked 2026-10-29:
 *   OpenAI     https://developers.openai.com/api/docs/pricing (Standard tier)
 *   Google     https://ai.google.dev/gemini-api/docs/pricing (paid tier)
 *   Anthropic  first-party API rates; cache write = 1.25x input (5 min),
 *              cache read = 0.1x input
 *
 * Change a price ONLY by adding a new PRICE_VERSION; rows keep the version
 * they were priced with.
 */

export const PRICE_VERSION = '2026-10-29'

export type ModelPrice = {
  input: number
  cachedInput: number
  /** Price per 1M cache-WRITE tokens, when the provider bills writes separately. */
  cacheWrite?: number
  output: number
  /** Above this many input tokens the long-context rates apply. */
  longContext?: { aboveInputTokens: number; price: Omit<ModelPrice, 'longContext'> }
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // OpenAI
  'gpt-5.6-sol': {
    input: 4,
    cachedInput: 0.4,
    cacheWrite: 5,
    output: 20,
    longContext: { aboveInputTokens: 272_000, price: { input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 } },
  },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Anthropic
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-opus-4-7': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  // Google (text input; context-cache storage is not per request and not priced here)
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 },
}

/** OpenAI hosted web search: $10 per 1,000 calls (content tokens billed at model rates). */
export const WEB_SEARCH_USD_PER_CALL = 0.01
/** OpenAI's published estimate for gpt-4o-transcribe. */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006

/** Exact id first, then the id without a trailing date snapshot (`gpt-4.1-mini-2025-04-14`). */
export function priceFor(model: string | null | undefined): { id: string; price: ModelPrice } | null {
  if (!model) return null
  const id = model.trim().toLowerCase()
  if (MODEL_PRICES[id]) return { id, price: MODEL_PRICES[id] }
  const undated = id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  return MODEL_PRICES[undated] ? { id: undated, price: MODEL_PRICES[undated] } : null
}

export type UsageTokens = {
  inputTokens: number | null
  uncachedInputTokens: number | null
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
}

export type CostVerdict =
  | { costUsd: number; costBasis: 'reported_usage' | 'estimated'; costNote: string | null; priceVersion: string }
  | { costUsd: null; costBasis: 'unknown'; costNote: string; priceVersion: string | null }

/**
 * Price one provider request. Never returns 0 for something it could not
 * price: missing usage or an unlisted model is `unknown`. When the provider
 * did not split the input (no cache details), all input is charged at the full
 * rate and the result is `estimated`, never `reported_usage`.
 */
export function priceUsage(
  models: { response?: string | null; requested: string },
  usage: UsageTokens | null,
  extras: { webSearchCalls?: number } = {},
): CostVerdict {
  if (!usage || usage.inputTokens == null || usage.outputTokens == null) {
    return { costUsd: null, costBasis: 'unknown', costNote: 'usage_missing', priceVersion: PRICE_VERSION }
  }
  const hit = priceFor(models.response) ?? priceFor(models.requested)
  if (!hit) return { costUsd: null, costBasis: 'unknown', costNote: 'unpriced_model', priceVersion: null }
  const lc = hit.price.longContext
  const p = lc && usage.inputTokens > lc.aboveInputTokens ? lc.price : hit.price
  const notes: string[] = []
  let estimated = false

  const read = usage.cachedInputTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  let uncached = usage.uncachedInputTokens
  if (uncached == null) {
    uncached = Math.max(0, usage.inputTokens - read - write)
    if (usage.cachedInputTokens == null) {
      estimated = true
      notes.push('input_split_missing')
    }
  }
  const writePrice = p.cacheWrite ?? p.input
  if (write > 0 && p.cacheWrite == null) {
    estimated = true
    notes.push('cache_write_unpriced')
  }
  if (p.cacheWrite != null && usage.cacheWriteTokens == null && read > 0) {
    // Writes are billed separately for this model but were not reported: they
    // are counted inside `uncached` at the (lower) input rate.
    estimated = true
    notes.push('cache_write_unreported')
  }

  const search = (extras.webSearchCalls ?? 0) * WEB_SEARCH_USD_PER_CALL
  const costUsd = (uncached * p.input + read * p.cachedInput + write * writePrice + usage.outputTokens * p.output) / 1e6 + search
  return {
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    costBasis: estimated ? 'estimated' : 'reported_usage',
    costNote: notes.length ? notes.join(',') : null,
    priceVersion: PRICE_VERSION,
  }
}
