import { priceFor, TRANSCRIPTION_USD_PER_MINUTE, WEB_SEARCH_USD_PER_CALL, type ModelPrice } from '@/lib/ai/usage/pricing'

/**
 * A CONSERVATIVE UPPER BOUND on one provider request's cost, computed before
 * the request from what the application already holds. Pure.
 *
 *   input   ≤ UTF-8 bytes of everything sent (a token is at least one byte),
 *           priced at the WORST input rate (a cache write where one is billed);
 *   output  ≤ the request's own maxOutputTokens (reasoning included);
 *   search  ≤ the hosted-search ceiling, when the request can search.
 *
 * `basis` says how far the bound can be trusted:
 *   bounded    every term is bounded and priced;
 *   partial    priced, but part of the input cannot be measured beforehand
 *              (images, an Agent's later tool results) — the estimate is a
 *              floor of the true maximum for those requests;
 *   unbounded  no price for the model: the policy's `unboundedReserveUsd`.
 * Unknown is never treated as zero.
 */

export type BudgetEstimate = { usd: number; basis: 'bounded' | 'partial' | 'unbounded'; incomplete: boolean; note: string | null }

const utf8 = (s: string | null | undefined) => (s ? Buffer.byteLength(s, 'utf8') : 0)

function ratesFor(price: ModelPrice, inputTokens: number) {
  const lc = price.longContext
  const p = lc && inputTokens > lc.aboveInputTokens ? lc.price : price
  return { input: Math.max(p.input, p.cacheWrite ?? 0), output: p.output }
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6

/** One runStructured attempt. */
export function estimateStructuredRequest(input: {
  model: string
  system: string
  user: string
  imageCount?: number
  maxOutputTokens: number
  unboundedReserveUsd: number
}): BudgetEstimate {
  const hit = priceFor(input.model)
  if (!hit) return { usd: input.unboundedReserveUsd, basis: 'unbounded', incomplete: true, note: 'unpriced_model' }
  const inTokens = utf8(input.system) + utf8(input.user)
  const r = ratesFor(hit.price, inTokens)
  const usd = (inTokens * r.input + input.maxOutputTokens * r.output) / 1e6
  const images = (input.imageCount ?? 0) > 0
  return {
    usd: round(usd),
    basis: images ? 'partial' : 'bounded',
    incomplete: images,
    note: images ? 'image_input_unmeasured' : null,
  }
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
  const perStepIn = utf8(input.system) + messageBytes
  const steps = Math.max(1, input.maxSteps)
  const r = ratesFor(hit.price, perStepIn)
  const usd =
    (steps * perStepIn * r.input + steps * input.maxOutputTokens * r.output) / 1e6 +
    (input.maxSearchCalls ?? 0) * WEB_SEARCH_USD_PER_CALL
  return { usd: round(usd), basis: 'partial', incomplete: true, note: 'tool_results_unmeasured' }
}

/** Voice: the route caps recordings, so the duration — and the cost — is bounded. */
export function estimateTranscription(maxRecordingMs: number): BudgetEstimate {
  return {
    usd: round((maxRecordingMs / 60_000) * TRANSCRIPTION_USD_PER_MINUTE),
    basis: 'bounded',
    incomplete: false,
    note: 'duration_cap',
  }
}
