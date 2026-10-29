import { priceUsage, type CostVerdict, type UsageTokens } from '@/lib/ai/usage/pricing'
import { combineVerdicts, verdictForCall, type ProviderCall } from '@/lib/ai/usage/record'
import type { ShadowOutcome } from '@/lib/ai/budget/shadow'

/**
 * The shadow-budget settlement for ONE Agent generateText call.
 *
 * Each step is its own provider request, so each is priced on its own — its
 * own model, usage, billing tier and context length — with the very verdict
 * its ledger row records (`verdictForCall`), and only then summed
 * (`combineVerdicts`). Pricing the call's aggregate usage instead would apply
 * the per-request long-context threshold to the whole run.
 *
 * `calls` are exactly the ledger rows written for this call (stepIndex
 * `stepIndexFrom`…), so the reservation equals their sum and records the link.
 * With no per-step rows at all, the aggregate is priced as a last resort and
 * can only be `estimated` (`step_breakdown_missing`) or `unknown`.
 */
export function agentCallSettlement(input: {
  outcome: 'success' | 'error'
  calls: readonly ProviderCall[]
  stepIndexFrom: number
  requestedModel: string
  totalUsage: UsageTokens | null
}): ShadowOutcome {
  const models = { requested: input.requestedModel }
  if (!input.calls.length) {
    const v = priceUsage(models, input.totalUsage)
    const verdict: CostVerdict =
      v.costBasis === 'unknown'
        ? v
        : { ...v, costBasis: 'estimated', costNote: ['step_breakdown_missing', v.costNote].filter(Boolean).join(',') }
    return { outcome: input.outcome, usage: input.totalUsage, models, verdict, stepIndexFrom: input.stepIndexFrom, stepCount: 0 }
  }
  const responseModels = [...new Set(input.calls.map((c) => c.responseModel).filter((m): m is string => !!m))]
  return {
    outcome: input.outcome,
    usage: null,
    models: { ...models, response: responseModels.at(-1) ?? null },
    verdict: combineVerdicts(input.calls.map(verdictForCall)),
    responseModels,
    stepIndexFrom: input.stepIndexFrom,
    stepCount: input.calls.length,
  }
}
