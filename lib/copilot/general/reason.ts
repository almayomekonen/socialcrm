import { runStructured } from '@/lib/ai/router'
import { resolveCopilotModeRole, type CopilotModeId } from '@/lib/ai/copilotModes'
import { GENERAL_REASON_SCHEMA, GENERAL_REASON_SYSTEM_PROMPT, type GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { FactsBundle } from './facts/types'
import type { Objective } from './objective'
import { classifyStates } from './businessState'
import { buildSituationReport } from './situationReport'

function buildUserMessage(objective: Objective, facts: FactsBundle): string {
  const states = classifyStates(facts)
  const report = buildSituationReport(objective, states, facts)
  return `מטרת המשתמש: ${objective}\n\nתמונת מצב (אמת בלבד — השתמש רק בה):\n${report}`
}

export interface ReasonOpts {
  agencyId: number
  userId?: number | null
  mode?: CopilotModeId
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
    user: buildUserMessage(objective, facts),
    agencyId: opts.agencyId,
    userId: opts.userId ?? null,
    roleOverride: resolveCopilotModeRole(opts.mode),
    copilotModeId: opts.mode,
  })
  if (!out.ok) return null
  return out.data
}
