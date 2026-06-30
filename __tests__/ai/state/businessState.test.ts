import { describe, it, expect } from 'vitest'
import { classifyStates, type BusinessStateKind } from '@/lib/copilot/general/businessState'
import type { FactsBundle } from '@/lib/copilot/general/facts/types'

const ALLOWED: BusinessStateKind[] = ['BROKEN_COMMITMENT', 'WAITING_CUSTOMER', 'GOING_COLD', 'FOLLOWUP_DUE', 'NEW_LEAD']
const FORBIDDEN = ['HIGH_PRIORITY', 'CALL_NOW', 'IMPORTANT', 'FOLLOW_UP_FIRST', 'TOP_LEAD']

const row = (id: number, name: string, ageDays: number | null, source: string) => ({ refId: String(id), name, status: null, ageDays, source })

const facts: FactsBundle = {
  groups: [
    { source: 'tasks.overdue', total: 1, rows: [row(1, 'A', 6, 'tasks.overdue') as never] },
    { source: 'leads.notContactedRecently', total: 3, rows: [row(2, 'B', 20, 'leads.notContactedRecently') as never, row(3, 'C', 10, 'leads.notContactedRecently') as never, row(4, 'D', 3, 'leads.notContactedRecently') as never] },
    { source: 'followups.promisedWaiting', total: 1, rows: [row(5, 'E', null, 'followups.promisedWaiting') as never] },
    { source: 'followups.dueToday', total: 1, rows: [row(6, 'F', null, 'followups.dueToday') as never] },
    { source: 'leads.newThisWeek', total: 1, rows: [row(7, 'G', null, 'leads.newThisWeek') as never] },
    { source: 'inbox.unread', total: 4, rows: [], meta: { conversations: 2, unread: 4 } },
  ],
}

describe('Business State Engine — classifyStates', () => {
  it('classifies each fact source into its operational state', () => {
    const byRef = Object.fromEntries(classifyStates(facts).map((s) => [s.refId, s.state]))
    expect(byRef['1']).toBe('BROKEN_COMMITMENT')
    expect(byRef['2']).toBe('GOING_COLD')
    expect(byRef['5']).toBe('WAITING_CUSTOMER')
    expect(byRef['6']).toBe('FOLLOWUP_DUE')
    expect(byRef['7']).toBe('NEW_LEAD')
  })

  it('emits no per-entity state for count-only sources (inbox)', () => {
    expect(classifyStates(facts).some((s) => s.metadata.source === 'inbox.unread')).toBe(false)
  })

  it('emits NO importance projection — severity/priority/score are gone (ranking is the Reasoner\'s)', () => {
    for (const s of classifyStates(facts)) {
      expect(s).not.toHaveProperty('severity')
      expect(s).not.toHaveProperty('priority')
      expect(s).not.toHaveProperty('score')
    }
  })

  it('preserves the deterministic measurements in metadata', () => {
    const cold = classifyStates(facts).find((s) => s.refId === '2')!
    expect(cold.metadata.ageDays).toBe(20)
    expect(cold.metadata.clusterSize).toBe(3)
  })

  it('never emits a decision dressed as a state', () => {
    for (const s of classifyStates(facts)) {
      expect(ALLOWED).toContain(s.state)
      expect(FORBIDDEN).not.toContain(s.state)
    }
  })

  it('carries the citation refId and a measurable evidence string', () => {
    const cold = classifyStates(facts).find((s) => s.refId === '2')!
    expect(cold.evidence).toContain('20')
    expect(typeof cold.refId).toBe('string')
  })

  it('is deterministic: same facts → identical states', () => {
    expect(classifyStates(facts)).toEqual(classifyStates(facts))
  })
})
