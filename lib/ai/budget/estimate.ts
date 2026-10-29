import {
  maxCacheWriteRate,
  priceFor,
  TRANSCRIPTION_USD_PER_MINUTE,
  WEB_SEARCH_USD_PER_CALL,
  type ModelPrice,
} from '@/lib/ai/usage/pricing'

/**
 * A pre-request ESTIMATE of one provider request's cost, computed from what the
 * application already holds. Pure. It is an upper bound only where `basis` is
 * `bounded`; every request path today is `partial` or `unbounded` (below), so
 * no estimate here is a guaranteed maximum.
 *
 *   input   UTF-8 bytes of everything the application sends and can measure
 *           (a token is at least one byte): system, user/messages, and the
 *           structured-output schema / tool definitions, priced at the WORST
 *           input rate (a cache write where one is billed);
 *   output  ≤ the request's own maxOutputTokens (reasoning included);
 *   search  ≤ the hosted-search ceiling, when the request can search.
 *
 * `basis` says how far the bound can be trusted:
 *   bounded    every input component is measured and priced;
 *   partial    priced, but part of the input cannot be measured beforehand —
 *              the estimate is a FLOOR of the true maximum for those requests;
 *   unbounded  no price for the model: the policy's `unboundedReserveUsd`.
 * Unknown is never treated as zero.
 *
 * A structured request is ALWAYS partial. The schema is measured, but each
 * provider wraps it in input it adds itself and that cannot be measured here:
 * Anthropic may send it as a forced `json` tool (with its tool-use system
 * prompt), OpenAI as a `text.format` json_schema, Google as a converted
 * OpenAPI `responseSchema`; plus per-message framing. (`provider_overhead_unmeasured`)
 */

export type BudgetEstimate = { usd: number; basis: 'bounded' | 'partial' | 'unbounded'; incomplete: boolean; note: string | null }

const utf8 = (s: string | null | undefined) => (s ? Buffer.byteLength(s, 'utf8') : 0)

function ratesFor(price: ModelPrice, inputTokens: number) {
  const lc = price.longContext
  const p = lc && inputTokens > lc.aboveInputTokens ? lc.price : price
  return { input: Math.max(p.input, maxCacheWriteRate(p) ?? 0), output: p.output }
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6

/** One runStructured attempt. `schemaBytes` null = the schema could not be measured. */
export function estimateStructuredRequest(input: {
  model: string
  system: string
  user: string
  schemaBytes: number | null
  schemaName?: string
  schemaDescription?: string
  imageCount?: number
  maxOutputTokens: number
  unboundedReserveUsd: number
}): BudgetEstimate {
  const hit = priceFor(input.model)
  if (!hit) return { usd: input.unboundedReserveUsd, basis: 'unbounded', incomplete: true, note: 'unpriced_model' }
  const inTokens =
    utf8(input.system) + utf8(input.user) + (input.schemaBytes ?? 0) + utf8(input.schemaName) + utf8(input.schemaDescription)
  const r = ratesFor(hit.price, inTokens)
  const usd = (inTokens * r.input + input.maxOutputTokens * r.output) / 1e6
  const notes = ['provider_overhead_unmeasured']
  if (input.schemaBytes == null) notes.push('schema_unmeasured')
  if ((input.imageCount ?? 0) > 0) notes.push('image_input_unmeasured')
  return { usd: round(usd), basis: 'partial', incomplete: true, note: notes.join(',') }
}

/**
 * One Agent generateText call of up to `maxSteps` steps. Each step re-sends
 * the conversation plus every tool result so far; tool results are unknown in
 * advance, so this bounds the KNOWN part (initial messages × steps) and the
 * outputs, and is labelled partial.
 */
export function estimateAgentCall(input: {
  model: string
  system: string
  messages: unknown
  maxSteps: number
  maxOutputTokens: number
  maxSearchCalls?: number
  /** Tool definitions + output schema, re-sent on every step. null = not measured. */
  definitionBytes?: number | null
  unboundedReserveUsd: number
}): BudgetEstimate {
  const hit = priceFor(input.model)
  if (!hit) return { usd: input.unboundedReserveUsd, basis: 'unbounded', incomplete: true, note: 'unpriced_model' }
  let messageBytes = 0
  try {
    messageBytes = utf8(JSON.stringify(input.messages ?? []))
  } catch {
    messageBytes = 0
  }
  const perStepIn = utf8(input.system) + messageBytes + (input.definitionBytes ?? 0)
  const steps = Math.max(1, input.maxSteps)
  const r = ratesFor(hit.price, perStepIn)
  const usd =
    (steps * perStepIn * r.input + steps * input.maxOutputTokens * r.output) / 1e6 +
    (input.maxSearchCalls ?? 0) * WEB_SEARCH_USD_PER_CALL
  const notes = ['tool_results_unmeasured', 'provider_overhead_unmeasured']
  if (input.definitionBytes === null) notes.push('definitions_unmeasured')
  return { usd: round(usd), basis: 'partial', incomplete: true, note: notes.join(',') }
}

/**
 * Voice: priced at the recording cap — PARTIAL. The server refuses an upload
 * whose container metadata declares more than the cap, but metadata can be
 * absent or forged and bytes do not bound duration (Opus DTX), so a longer
 * file cannot be ruled out. The browser recorder's limit is not a server
 * control. The per-minute price is also OpenAI's published estimate.
 */
export function estimateTranscription(maxRecordingMs: number, metadataDurationMs: number | null = null): BudgetEstimate {
  return {
    usd: round((maxRecordingMs / 60_000) * TRANSCRIPTION_USD_PER_MINUTE),
    basis: 'partial',
    incomplete: true,
    note: metadataDurationMs == null ? 'duration_unverified' : 'duration_unverified,duration_metadata_within_cap',
  }
}
