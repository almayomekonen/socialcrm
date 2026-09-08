import 'server-only'
import { openai } from '@ai-sdk/openai'

/**
 * The ONE external capability, and the only tool in this product the model can
 * reach that is not a scoped read of the customer's own database.
 *
 * PROVIDER-EXECUTED, which is the fact everything around it is designed for.
 * OpenAI runs the search; our code is never called. That means it does not pass
 * through `budget.canStep()`, does not appear in `toolTimings`, and cannot write
 * to the EvidenceCollector the way the nine CRM readers do from inside their
 * `execute`. Its results become citable only through the harvest at the phase
 * seam in `run.ts` — see `./harvest.ts` for the measurements this rests on.
 *
 * WHY WE DO NOT WRAP IT IN A LOCAL FUNCTION TOOL. A wrapper would let us count
 * calls and charge the Budget, and it would cost the thing that makes this
 * worth using: OpenAI's own search, reading and citation, replaced by whatever
 * HTTP client we wrote. It would also put attacker-controlled page text through
 * our process and into our storage — the injection surface this phase exists to
 * avoid. The honest trade is to accept that breadth is bounded by the wall clock
 * and the harvest caps rather than by a step counter, and to say so plainly.
 *
 * `searchContextSize: 'medium'`. `high` is the default temptation and the
 * default overspend; medium answered every measured question with sources to
 * spare, and the harvest caps at eight anyway.
 *
 * NO DOMAIN FILTER IS SET. `filters.allowedDomains` sounds like a security
 * control and is not one: an allowlist that could be trusted would have to be
 * per-industry and per-tenant, and a wrong one silently narrows the world to a
 * few sites while looking authoritative. Safety here comes from what external
 * content CANNOT do — it cannot ground a FACT, select a lead, or authorise an
 * action — not from guessing which publishers are honest.
 */
export function researchTool() {
  return {
    web_search: openai.tools.webSearch({ searchContextSize: 'medium' }),
  }
}

/** The tool name the provider reports, used to count searches in the trace. */
export const RESEARCH_TOOL_NAME = 'web_search'
