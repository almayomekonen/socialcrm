import { describe, it, expect } from 'vitest'
import { validateReasoning } from '@/lib/copilot/general/validate'
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'

// validIds = {1,2,3}; sumTotals = 5 + 3 + 4 = 12
const facts: FactsBundle = {
  groups: [
    {
      source: 'tasks.overdue',
      total: 5,
      rows: [
        { refId: '1', name: 'A', status: null, ageDays: 2, source: 'tasks.overdue' },
        { refId: '2', name: 'B', status: null, ageDays: 1, source: 'tasks.overdue' },
      ],
    },
    { source: 'leads.notContactedRecently', total: 3, rows: [{ refId: '3', name: 'C', status: null, ageDays: 10, source: 'leads.notContactedRecently' }] },
    { source: 'inbox.unread', total: 4, rows: [], meta: { conversations: 2, unread: 4 } },
  ],
}

type Action = GeneralReasonOutput['actions'][number]
const act = (action: string, evidence: string[], priority: Action['priority'] = 'high'): Action => ({ action, why: 'because', evidence, priority })
const out = (actions: Action[], moreCount = 0): GeneralReasonOutput => ({ allClear: false, executiveDecision: 'do X', actions, moreCount })

describe('Trust Gate — validateReasoning', () => {
  it('passes a fully supported answer through unchanged', () => {
    const r = validateReasoning(out([act('call A', ['1'])], 2), facts)!
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].evidence).toEqual(['1'])
    expect(r.moreCount).toBe(2)
    expect(r.diagnostics.rejectedActions).toHaveLength(0)
  })

  it('removes invented evidence ids and rejects the now-unsupported action', () => {
    expect(validateReasoning(out([act('ghost', ['999'])]), facts)).toBeNull()
  })

  it('dedupes duplicated evidence', () => {
    const r = validateReasoning(out([act('call A', ['1', '1', '1'])]), facts)!
    expect(r.actions[0].evidence).toEqual(['1'])
  })

  it('keeps valid actions and rejects only the unsupported ones (partial validity)', () => {
    const r = validateReasoning(out([act('good', ['1']), act('bad', ['999'])]), facts)!
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].action).toBe('good')
    expect(r.diagnostics.rejectedActions).toHaveLength(1)
    expect(r.diagnostics.rejectedActions[0]).toMatchObject({ action: 'bad', rule: 'no-valid-evidence', removedEvidence: ['999'] })
  })

  it('trims unsupported evidence from a surviving action (records it for devs)', () => {
    const r = validateReasoning(out([act('call A', ['1', '999'])]), facts)!
    expect(r.actions[0].evidence).toEqual(['1'])
    expect(r.diagnostics.trimmedEvidence).toEqual([{ action: 'call A', removed: ['999'] }])
  })

  it('returns null for a completely fabricated response (never rescues)', () => {
    expect(validateReasoning(out([act('a', ['999']), act('b', ['888', '777'])]), facts)).toBeNull()
  })

  it('returns null when not all-clear but no actions survive (meaningless)', () => {
    expect(validateReasoning(out([]), facts)).toBeNull()
  })

  it('clamps an inflated moreCount to deterministic reality', () => {
    const r = validateReasoning(out([act('call A', ['1'])], 9999), facts)!
    expect(r.moreCount).toBe(11) // sumTotals(12) - 1 surviving action
    expect(r.diagnostics.clampedMoreCount).toEqual({ from: 9999, to: 11 })
  })

  it('leaves a within-bounds moreCount untouched', () => {
    const r = validateReasoning(out([act('call A', ['1'])], 3), facts)!
    expect(r.moreCount).toBe(3)
    expect(r.diagnostics.clampedMoreCount).toBeNull()
  })

  it('normalizes all-clear: stray actions are removed, never surfaced', () => {
    const allClear: GeneralReasonOutput = { allClear: true, executiveDecision: 'הכול תחת שליטה.', actions: [act('sneaky', ['1'])], moreCount: 7 }
    const r = validateReasoning(allClear, facts)!
    expect(r.allClear).toBe(true)
    expect(r.actions).toEqual([])
    expect(r.moreCount).toBe(0)
    expect(r.diagnostics.rejectedActions[0]).toMatchObject({ action: 'sneaky', rule: 'all-clear-not-surfaced' })
  })

  it('keeps a clean all-clear', () => {
    const r = validateReasoning({ allClear: true, executiveDecision: 'הכול תחת שליטה.', actions: [], moreCount: 0 }, facts)!
    expect(r.allClear).toBe(true)
    expect(r.actions).toEqual([])
  })

  it('quarantines rejection detail in diagnostics, never in the user-facing payload', () => {
    const r = validateReasoning(out([act('good', ['1']), act('bad', ['999'])]), facts)!
    expect(r.actions.map((a) => a.action)).not.toContain('bad')
    expect(JSON.stringify({ allClear: r.allClear, executiveDecision: r.executiveDecision, actions: r.actions, moreCount: r.moreCount })).not.toContain('999')
  })

  it('is deterministic: same input → identical output', () => {
    const input = out([act('good', ['1', '999']), act('bad', ['888'])], 50)
    expect(validateReasoning(input, facts)).toEqual(validateReasoning(input, facts))
  })

  it('rejects unsupported conversion claims even when evidence ids are valid', () => {
    const hot: GeneralReasonOutput = {
      allClear: false,
      executiveDecision: 'George הוא ליד חם עם סיכוי גבוה לסגירה.',
      actions: [act('call A', ['1'])],
      moreCount: 0,
    }
    expect(validateReasoning(hot, facts)).toBeNull()
  })

  it('rejects English conversion-probability claims', () => {
    const r: GeneralReasonOutput = {
      allClear: false,
      executiveDecision: 'This hot lead has a high probability of closing.',
      actions: [{ action: 'call A', why: 'will increase conversions', evidence: ['1'], priority: 'high' }],
      moreCount: 0,
    }
    expect(validateReasoning(r, facts)).toBeNull()
  })
})
