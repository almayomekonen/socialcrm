import { inferObjective } from './objective'
import { classifyFallback } from './fallback'
import { gatherTriageFacts } from './facts/gatherFacts'
import { reasonOverFacts } from './reason'
import { validateReasoning } from './validate'
import { buildDecisionTrace, emitDecisionTrace } from './decisionTrace'
import type { Scope } from '@/db/briefing'
import type { CopilotModeId } from '@/lib/ai/copilotModes'

export function shouldReason(text: string): boolean {
  const { objective } = inferObjective({ text })
  if (objective === 'create') return false // compose tasks are not open-ended business questions
  if (objective === 'summarize') return false // status questions → deterministic overview, not the Reasoner
  const fb = classifyFallback(text)
  if (fb.mode === 'ack') return false
  if (fb.mode === 'clarify' && objective === 'action') return false
  return true
}

export type ReasonedAction = {
  action: string
  why: string
  priority: 'high' | 'medium' | 'low'
  leadId: number | null
}

export type ReasonedAnswer = {
  kind: 'reasoned'
  allClear: boolean
  executiveDecision: string
  actions: ReasonedAction[]
  moreCount: number
}

export interface TryReasonedInput {
  text: string
  scope: Scope
  agencyId: number
  userId?: number | null
  mode?: CopilotModeId
}

export async function tryReasonedAnswer(input: TryReasonedInput): Promise<ReasonedAnswer | null> {
  const startedAt = Date.now()

  const { objective } = inferObjective({ text: input.text })
  if (objective === 'create') return null

  const facts = await gatherTriageFacts(input.scope)

  const reasoned = await reasonOverFacts(objective, facts, {
    agencyId: input.agencyId,
    userId: input.userId,
    mode: input.mode,
  })
  if (!reasoned) {
    emitDecisionTrace(
      buildDecisionTrace({
        objective,
        facts,
        startedAt,
        now: Date.now(),
        outcome: 'fallback',
        terminatedAt: 'executiveDecision',
      }),
    )
    return null
  }

  const validated = validateReasoning(reasoned, facts)
  if (!validated) {
    emitDecisionTrace(
      buildDecisionTrace({
        objective,
        facts,
        reasoned,
        startedAt,
        now: Date.now(),
        outcome: 'fallback',
        terminatedAt: 'trustValidation',
      }),
    )
    return null
  }

  const answer: ReasonedAnswer = {
    kind: 'reasoned',
    allClear: validated.allClear,
    executiveDecision: validated.executiveDecision,
    actions: validated.actions.map((a) => {
      const n = a.evidence.length ? Number(a.evidence[0]) : NaN
      return {
        action: a.action,
        why: a.why,
        priority: a.priority,
        leadId: Number.isFinite(n) ? n : null,
      }
    }),
    moreCount: validated.moreCount,
  }

  emitDecisionTrace(
    buildDecisionTrace({ objective, facts, reasoned, validated, startedAt, now: Date.now(), outcome: 'answered' }),
  )
  return answer
}
