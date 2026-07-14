import { inferObjective } from './objective'
import { classifyFallback } from './fallback'
import { gatherTriageFacts } from './facts/gatherFacts'
import { isRuntimeCognitionEnabledForUser } from '@/lib/copilot/featureFlag'
import { getRuntimeCognition, formatRuntimeCognitionForCandidates } from './runtimeCognition'
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

  // Additive, flag-gated: the CRM situation picture already SELECTED the candidate
  // subjects (facts.groups[].rows[].refId). Reuse the exact per-subject Runtime
  // bridge to EXPLAIN each candidate (the Copilot aggregates; the Runtime never
  // ranks). Fully guarded — off/error → the executive prompt is unchanged.
  let runtimeCognition: string | undefined
  if (isRuntimeCognitionEnabledForUser({ agencyId: input.agencyId })) {
    try {
      const rows = facts.groups.flatMap((g) => g.rows)
      const leadIds = Array.from(new Set(rows.map((r) => r.refId))).filter((id) => id.length > 0)
      if (leadIds.length > 0) {
        const cognitions = await getRuntimeCognition({ agencyId: input.agencyId }, leadIds)
        const labelById = new Map(rows.map((r) => [r.refId, r.name]))
        runtimeCognition =
          formatRuntimeCognitionForCandidates(
            cognitions.map((c) => ({ label: labelById.get(c.leadId) ?? c.leadId, cognition: c })),
          ) ?? undefined
      }
    } catch {
      // cognition is additive enrichment — never break the executive answer path
    }
  }

  const reasoned = await reasonOverFacts(objective, facts, {
    agencyId: input.agencyId,
    userId: input.userId,
    mode: input.mode,
    runtimeCognition,
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
