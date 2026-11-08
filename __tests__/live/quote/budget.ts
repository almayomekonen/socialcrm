/**
 * The hard spending cap, enforced at the fetch layer so a retry counts too.
 *
 * Before each request: spent + in flight + this request's ceiling + reserve must
 * fit the limit, or the request never leaves the machine and the run stops.
 * The ceiling assumes the worst: every input token uncached at the highest input
 * rate, and the full output allowance.
 *
 * After a response the reported usage replaces the ceiling. No usage, or a
 * network failure where the provider may still have billed, keeps the ceiling.
 */

export type BudgetPrice = { inputPerM: number; cachedInputPerM: number; outputPerM: number }
export type RequestRecord = { bodyChars: number; ceilingUsd: number; costUsd: number; inputTokens: number; cachedTokens: number; outputTokens: number; status: number; usageReported: boolean }
export type BudgetState = { spentUsd: number; inFlightUsd: number; stopped: boolean; refusedRequests: number; requests: RequestRecord[] }

export class BudgetStop extends Error {
  constructor(detail: string) {
    super(`[live harness] budget stop: ${detail}`)
    this.name = 'BudgetStop'
  }
}

/** A single run may lower the file's cap, never raise it. Anything unreadable stops the run rather than falling back. */
export function effectiveCapUsd(fileCap: number, override: string | undefined): number {
  if (override === undefined) return fileCap
  const lowered = override.trim() === '' ? Number.NaN : Number(override)
  if (!(lowered > 0)) throw new BudgetStop('QUOTE_LIVE_CAP_USD is not a positive number')
  return Math.min(fileCap, lowered)
}

const usd = (tokens: number, perM: number) => (tokens * perM) / 1_000_000

export function ceilingFor(body: string, maxOutputTokens: number, price: BudgetPrice): number {
  return usd(Math.ceil(body.length / 2), price.inputPerM) + usd(maxOutputTokens, price.outputPerM)
}

export function createBudget(opts: { inner: typeof fetch; capUsd: number; reserveUsd: number; price: BudgetPrice; defaultMaxOutputTokens: number }) {
  if (!(opts.capUsd > 0) || !(opts.reserveUsd > 0) || opts.reserveUsd >= opts.capUsd) throw new Error('budget: invalid cap or reserve')
  const state: BudgetState = { spentUsd: 0, inFlightUsd: 0, stopped: false, refusedRequests: 0, requests: [] }

  const budgeted = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    let maxOutput = opts.defaultMaxOutputTokens
    try {
      maxOutput = Number(JSON.parse(body).max_output_tokens) || maxOutput
    } catch {
      // Not JSON: the default allowance stands.
    }
    const ceilingUsd = ceilingFor(body, maxOutput, opts.price)
    if (state.stopped || state.spentUsd + state.inFlightUsd + ceilingUsd + opts.reserveUsd > opts.capUsd) {
      state.stopped = true
      state.refusedRequests++
      throw new BudgetStop(`spent ${state.spentUsd.toFixed(4)} of ${opts.capUsd}`)
    }
    state.inFlightUsd += ceilingUsd
    const record: RequestRecord = { bodyChars: body.length, ceilingUsd, costUsd: ceilingUsd, inputTokens: 0, cachedTokens: 0, outputTokens: 0, status: 0, usageReported: false }
    state.requests.push(record)
    try {
      const res = await opts.inner(input, init)
      record.status = res.status
      const parsed = (await res.clone().json().catch(() => null)) as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } } | null
      const u = parsed?.usage
      if (u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
        record.inputTokens = u.input_tokens
        record.cachedTokens = u.input_tokens_details?.cached_tokens ?? 0
        record.outputTokens = u.output_tokens
        record.usageReported = true
        record.costUsd = usd(u.input_tokens - record.cachedTokens, opts.price.inputPerM) + usd(record.cachedTokens, opts.price.cachedInputPerM) + usd(u.output_tokens, opts.price.outputPerM)
      } else if (res.status >= 400 && res.status < 500) {
        record.costUsd = 0 // Refused by the provider: not billed.
      }
      return res
    } finally {
      state.inFlightUsd -= ceilingUsd
      state.spentUsd += record.costUsd
    }
  }) as typeof fetch

  return { fetch: budgeted, state }
}
