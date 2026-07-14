import { runStructured } from '@/lib/ai/router'
import { resolveCopilotModeRole, type CopilotModeId } from '@/lib/ai/copilotModes'
import { GENERAL_REASON_SCHEMA, GENERAL_REASON_SYSTEM_PROMPT, type GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { FactsBundle } from './facts/types'
import type { Objective } from './objective'
import { classifyStates } from './businessState'
import { buildSituationReport } from './situationReport'

function buildUserMessage(objective: Objective, facts: FactsBundle, runtimeCognition?: string): string {
  const states = classifyStates(facts)
  const report = buildSituationReport(objective, states, facts)
  const base = `מטרת המשתמש: ${objective}\n\nתמונת מצב (אמת בלבד — השתמש רק בה):\n${report}`
  // Additive: the Runtime's per-candidate cognition is a separate, authoritative
  // understanding layer (not part of the factual situation picture). Absent when
  // the flag is off → the message is byte-for-byte unchanged.
  return runtimeCognition ? `${base}\n\n${runtimeCognition}` : base
}

export interface ReasonOpts {
  agencyId: number
  userId?: number | null
  mode?: CopilotModeId
  /** Optional AI Runtime cognition block (per candidate). Additive; off by default. */
  runtimeCognition?: string
}

export async function reasonOverFacts(
  objective: Objective,
  facts: FactsBundle,
  opts: ReasonOpts,
): Promise<GeneralReasonOutput | null> {
  const out = await runStructured({
    kind: 'copilot.generalReason',
    schema: GENERAL_REASON_SCHEMA,
    schemaName: 'ExecutiveRecommendation',
    system: GENERAL_REASON_SYSTEM_PROMPT,
    user: buildUserMessage(objective, facts, opts.runtimeCognition),
    agencyId: opts.agencyId,
    userId: opts.userId ?? null,
    roleOverride: resolveCopilotModeRole(opts.mode),
    copilotModeId: opts.mode,
  })
  if (!out.ok) return null
  return out.data
}
