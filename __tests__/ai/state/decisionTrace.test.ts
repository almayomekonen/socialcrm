import { describe, it, expect } from 'vitest'
import { buildDecisionTrace } from '@/lib/copilot/general/decisionTrace'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { ValidatedReasoning } from '@/lib/copilot/general/validate'

const row = (id: number, name: string, ageDays: number | null, source: string) => ({ refId: String(id), name, status: null, ageDays, source })

const facts: FactsBundle = {
  groups: [
    { source: 'tasks.overdue', total: 2, rows: [row(1, 'גיא', 6, 'tasks.overdue') as never, row(2, 'עדי', 1, 'tasks.overdue') as never] },
    { source: 'leads.notContactedRecently', total: 5, rows: [row(3, 'דנה', 22, 'leads.notContactedRecently') as never] },
    { source: 'inbox.unread', total: 4, rows: [], meta: { conversations: 2, unread: 4 } },
  ],
}

const reasoned: GeneralReasonOutput = {
  allClear: false,
  executiveDecision: 'קודם גיא — הוא מתקרר.',
  actions: [{ action: 'התקשר לגיא', why: '22 ימים בלי קשר', evidence: ['3', '999'], priority: 'high' }],
  moreCount: 6,
}

const validated: ValidatedReasoning = {
  allClear: false,
  executiveDecision: 'קודם גיא — הוא מתקרר.',
  actions: [{ action: 'התקשר לגיא', why: '22 ימים בלי קשר', evidence: ['3'], priority: 'high' }],
  moreCount: 6,
  diagnostics: { rejectedActions: [], trimmedEvidence: [{ action: 'התקשר לגיא', removed: ['999'] }], clampedMoreCount: null },
}

describe('Decision Trace', () => {
  it('captures all seven stages for an answered recommendation', () => {
    const t = buildDecisionTrace({ objective: 'action', facts, reasoned, validated, startedAt: 0, now: 1200, outcome: 'answered' })
    expect(t.stages.facts.totalBySource['tasks.overdue']).toBe(2)
    expect(t.stages.states!.countByState['GOING_COLD']).toBe(1)
    expect(t.stages.situationReport!.chars).toBeGreaterThan(0)
    expect(t.stages.executiveDecision!.decision).toContain('גיא')
    expect(t.stages.evidence!.valid).toEqual(['3'])
    expect(t.stages.evidence!.removed).toEqual(['999']) // hallucinated id surfaced in the trace
    expect(t.stages.trustValidation!.trimmed).toBe(1)
    expect(t.stages.finalAnswer!.actionCount).toBe(1)
    expect(t.latencyMs).toBe(1200)
  })

  it('marks a delivered single decision as a Decision Success (KPI signal)', () => {
    const t = buildDecisionTrace({ objective: 'action', facts, reasoned, validated, startedAt: 0, now: 1, outcome: 'answered' })
    expect(t.decisionSuccess).toBe(true)
  })

  it('does not count a fallback as a success and records where it terminated', () => {
    const t = buildDecisionTrace({ objective: 'action', facts, reasoned, startedAt: 0, now: 1, outcome: 'fallback', terminatedAt: 'trustValidation' })
    expect(t.decisionSuccess).toBe(false)
    expect(t.terminatedAt).toBe('trustValidation')
    expect(t.stages.finalAnswer).toBeNull()
  })

  it('excludes allClear (valid silence) from Decision Success', () => {
    const allClear: ValidatedReasoning = { allClear: true, executiveDecision: 'הכול תחת שליטה.', actions: [], moreCount: 0, diagnostics: { rejectedActions: [], trimmedEvidence: [], clampedMoreCount: null } }
    const t = buildDecisionTrace({ objective: 'action', facts, reasoned: { ...reasoned, allClear: true, actions: [] }, validated: allClear, startedAt: 0, now: 1, outcome: 'answered' })
    expect(t.allClear).toBe(true)
    expect(t.decisionSuccess).toBe(false)
  })
})
