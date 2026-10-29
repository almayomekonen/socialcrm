/**
 * Versioned provider prices for the AI usage ledger (USD per 1M tokens).
 *
 * Separate from `estimateCostUsd` (lib/ai/tasks.ts), which still drives the
 * in-memory spend cap and is deliberately untouched: this table only prices
 * ledger rows and shadow-budget estimates. A model that is neither listed nor
 * a documented alias is NOT guessed — its rows are `costBasis: 'unknown'`.
 *
 * PRICE RESOLUTION (`resolvePrice`), in this order:
 *   1. a direct price for the provider-reported model;
 *   2. a direct price for the requested model;
 *   3. only then a documented alias — reported model first, then requested.
 * "Direct" is the exact id or that id without a trailing date snapshot. An
 * alias matches the EXACT id only: a dated `gpt-5.6-YYYY-MM-DD` is never
 * aliased. The requested model is never changed; rows keep `requestedModel`
 * and `responseModel` separately. Alias pricing is an inference from
 * documentation, so it is always `estimated` (`priced_as_alias:<target>`), and
 * a reported model that could not be priced is noted (`response_model_unpriced`).
 *
 * WHAT USAGE METADATA DOES NOT ESTABLISH IS NOT ASSUMED:
 *   - cache-write duration: providers bill different write rates by duration
 *     (OpenAI 30 min / 12 h); the SDK reports write tokens without one, so any
 *     REPORTED write is priced at the HIGHEST listed write rate and marked
 *     `estimated` (`cache_write_duration_unknown`);
 *   - cache-write COUNT: `@ai-sdk/openai` (3.0.x) never reports one — its usage
 *     adapter sets cacheWrite to undefined — so for a model that bills writes
 *     separately, any uncached input may include writes. Those tokens are
 *     priced at the plain input rate (they are NOT reclassified as writes) and
 *     the cost is `estimated` (`cache_write_unreported`). This is a point
 *     estimate, NOT an upper bound: if some of those tokens were billed as
 *     writes, the true cost is higher by at most
 *     (highest write rate − input rate) × uncached input tokens;
 *   - billing tier: these are Standard-tier prices. `reported_usage` requires
 *     the provider to report the Standard tier; an unreported tier is
 *     `estimated`, any other reported tier is `unknown` (unpriced).
 *
 * Sources:
 *   OpenAI     https://developers.openai.com/api/docs/pricing (Standard tier, checked 2026-10-29)
 *              https://developers.openai.com/api/docs/models/gpt-5.6 (checked 2026-10-30):
 *              "The `gpt-5.6` alias routes requests to GPT-5.6 Sol."
 *   Google     https://ai.google.dev/gemini-api/docs/pricing (paid tier, checked 2026-10-29)
 *   Anthropic  first-party API rates; 5-minute cache write = 1.25x input,
 *              cache read = 0.1x input (other write durations are not listed here)
 *
 * Change a price ONLY by adding a new PRICE_VERSION; rows keep the version
 * they were priced with.
 */

export const PRICE_VERSION = '2026-10-30'

export type ModelPrice = {
  input: number
  cachedInput: number
  /** Cache-WRITE price per 1M tokens, by cache duration, when the provider bills writes separately. */
  cacheWrite?: Readonly<Record<string, number>>
  output: number
  /** Above this many input tokens the long-context rates apply to the whole request. */
  longContext?: { aboveInputTokens: number; price: Omit<ModelPrice, 'longContext'> }
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // OpenAI
  'gpt-5.6-sol': {
    input: 4,
    cachedInput: 0.4,
    cacheWrite: { '30m': 5, '12h': 10 },
    output: 20,
    longContext: {
      aboveInputTokens: 272_000,
      price: { input: 8, cachedInput: 0.8, cacheWrite: { '30m': 10, '12h': 20 }, output: 30 },
    },
  },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Anthropic
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, cacheWrite: { '5m': 3.75 }, output: 15 },
  'claude-opus-4-7': { input: 5, cachedInput: 0.5, cacheWrite: { '5m': 6.25 }, output: 25 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, cacheWrite: { '5m': 1.25 }, output: 5 },
  // Google (text input; context-cache storage is not per request and not priced here)
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 },
}

/** Documented provider aliases, for COST ESTIMATION ONLY (see the header). */
export const MODEL_PRICING_ALIASES: Readonly<Record<string, { target: string; source: string }>> = {
  'gpt-5.6': { target: 'gpt-5.6-sol', source: 'https://developers.openai.com/api/docs/models/gpt-5.6' },
}

/** OpenAI hosted web search: $10 per 1,000 calls (content tokens billed at model rates). */
export const WEB_SEARCH_USD_PER_CALL = 0.01
/** OpenAI's published estimate for gpt-4o-transcribe. */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006

/** Tier values the providers report for Standard processing. */
const STANDARD_TIERS = new Set(['default', 'standard'])

/** The highest listed cache-write rate (duration unknown → worst case), or null when writes are not billed separately. */
export function maxCacheWriteRate(p: Omit<ModelPrice, 'longContext'>): number | null {
  const rates = p.cacheWrite ? Object.values(p.cacheWrite) : []
  return rates.length ? Math.max(...rates) : null
}

type PriceHit = { id: string; price: ModelPrice; aliasOf?: string }

const normalise = (model: string | null | undefined) => (model ? model.trim().toLowerCase() : '')

/** A listed price: the exact id, then the id without a trailing date snapshot (`gpt-4.1-mini-2025-04-14`). Never an alias. */
export function directPriceFor(model: string | null | undefined): PriceHit | null {
  const id = normalise(model)
  if (!id) return null
  if (MODEL_PRICES[id]) return { id, price: MODEL_PRICES[id] }
  const undated = id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  return MODEL_PRICES[undated] ? { id: undated, price: MODEL_PRICES[undated] } : null
}

/** A documented alias, matched on the EXACT id only. */
function aliasPriceFor(model: string | null | undefined): PriceHit | null {
  const id = normalise(model)
  const alias = id ? MODEL_PRICING_ALIASES[id] : undefined
  return alias && MODEL_PRICES[alias.target] ? { id: alias.target, price: MODEL_PRICES[alias.target], aliasOf: id } : null
}

/** One model id (e.g. the requested model, before the request): a direct price, else a documented alias. */
export function priceFor(model: string | null | undefined): PriceHit | null {
  return directPriceFor(model) ?? aliasPriceFor(model)
}

export type PriceResolution = PriceHit & { via: 'response' | 'requested' | 'response_alias' | 'requested_alias' }

/** The precedence in the header: direct reported, direct requested, then an alias. */
export function resolvePrice(models: { response?: string | null; requested: string }): PriceResolution | null {
  const candidates: [PriceHit | null, PriceResolution['via']][] = [
    [directPriceFor(models.response), 'response'],
    [directPriceFor(models.requested), 'requested'],
    [aliasPriceFor(models.response), 'response_alias'],
    [aliasPriceFor(models.requested), 'requested_alias'],
  ]
  for (const [hit, via] of candidates) if (hit) return { ...hit, via }
  return null
}

export type UsageTokens = {
  inputTokens: number | null
  uncachedInputTokens: number | null
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
}

export type CostVerdict =
  | { costUsd: number; costBasis: 'reported_usage' | 'estimated'; costNote: string | null; priceVersion: string | null }
  | { costUsd: null; costBasis: 'unknown'; costNote: string; priceVersion: string | null }

/**
 * Price one provider request. Never returns 0 for something it could not
 * price: missing usage, an unlisted model or a non-Standard tier is `unknown`.
 * Anything the metadata does not establish (input split, cache-write
 * duration, tier) is priced conservatively and marked `estimated`.
 */
export function priceUsage(
  models: { response?: string | null; requested: string },
  usage: UsageTokens | null,
  extras: { webSearchCalls?: number; serviceTier?: string | null } = {},
): CostVerdict {
  if (!usage || usage.inputTokens == null || usage.outputTokens == null) {
    return { costUsd: null, costBasis: 'unknown', costNote: 'usage_missing', priceVersion: PRICE_VERSION }
  }
  const hit = resolvePrice(models)
  if (!hit) return { costUsd: null, costBasis: 'unknown', costNote: 'unpriced_model', priceVersion: null }
  const tier = extras.serviceTier ? String(extras.serviceTier).trim().toLowerCase() : null
  if (tier && !STANDARD_TIERS.has(tier)) {
    return {
      costUsd: null,
      costBasis: 'unknown',
      costNote: `unpriced_service_tier:${tier.slice(0, 20)}`,
      priceVersion: PRICE_VERSION,
    }
  }

  const lc = hit.price.longContext
  const p = lc && usage.inputTokens > lc.aboveInputTokens ? lc.price : hit.price
  const notes: string[] = []
  let estimated = false
  if (hit.aliasOf) {
    estimated = true
    notes.push(`priced_as_alias:${hit.id}`)
  }
  if (normalise(models.response) && (hit.via === 'requested' || hit.via === 'requested_alias')) {
    // The provider said which model served the request, and it is not one we can price.
    estimated = true
    notes.push('response_model_unpriced')
  }
  if (!tier) {
    estimated = true
    notes.push('service_tier_unreported')
  }

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
  const writeRate = maxCacheWriteRate(p)
  if (write > 0) {
    estimated = true
    notes.push(writeRate == null ? 'cache_write_unpriced' : 'cache_write_duration_unknown')
  }
  if (writeRate != null && usage.cacheWriteTokens == null && uncached > 0) {
    // Writes are billed separately for this model but their count was not
    // reported, with or without cache reads (a first, cache-creating request has
    // none). Any writes are inside `uncached`, priced at the lower input rate —
    // see the header for the bound on the understatement.
    estimated = true
    notes.push('cache_write_unreported')
  }

  const search = (extras.webSearchCalls ?? 0) * WEB_SEARCH_USD_PER_CALL
  const costUsd =
    (uncached * p.input + read * p.cachedInput + write * (writeRate ?? p.input) + usage.outputTokens * p.output) / 1e6 + search
  return {
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    costBasis: estimated ? 'estimated' : 'reported_usage',
    costNote: notes.length ? notes.join(',') : null,
    priceVersion: PRICE_VERSION,
  }
}
