import { describe, it, expect } from 'vitest'
import { buildLeadGlanceFacts, buildLeadSuggestedActions } from '@/lib/copilot/leadActions'
import type { FollowUpSignals } from '@/lib/ai/followUpRules'

// ─── buildLeadSuggestedActions ──────────────────────────────────────────────
// Today the only input that matters is `statusTone`. Pin it.

describe('buildLeadSuggestedActions', () => {
  it('returns empty for terminal leads (no actions on closed work)', () => {
    expect(buildLeadSuggestedActions({ statusTone: 'terminal' })).toEqual([])
  })

  it.each([['active'], ['warm'], ['cool'], ['unknown']] as const)(
    'returns the 2 predefined actions for %s leads',
    (statusTone) => {
      const actions = buildLeadSuggestedActions({ statusTone })
      expect(actions.map((a) => a.id)).toEqual(['draft-followup-message', 'next-best-step'])
      expect(actions.every((a) => a.tone === 'neutral')).toBe(true)
      expect(actions.every((a) => a.label.length > 0)).toBe(true)
    },
  )
})

// ─── buildLeadGlanceFacts ───────────────────────────────────────────────────
// Glance facts are the deterministic chips at the top of the panel. The
// rule pyramid (overdue > due-today > open > no-open) drives the first fact;
// silence/recency drives the second. Slice to 2 max.

const baseSignals: FollowUpSignals = {
  status: 'בטיפול',
  daysSinceLastInteraction: null,
  daysInCurrentStatus: null,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  openTaskCount: 0,
  taskCompletionRate: null,
}

const merge = (over: Partial<FollowUpSignals>): FollowUpSignals => ({ ...baseSignals, ...over })

describe('buildLeadGlanceFacts — task pyramid (first fact)', () => {
  it('overdue > due-today > open (overdue wins)', () => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ overdueTaskCount: 1, dueTodayTaskCount: 1, openTaskCount: 5 }),
      statusTone: 'active',
    })
    expect(facts[0]?.id).toBe('overdue')
    expect(facts[0]?.tone).toBe('urgent')
  })

  it('singular vs plural overdue copy', () => {
    expect(buildLeadGlanceFacts({ signals: merge({ overdueTaskCount: 1 }), statusTone: 'active' })[0]?.label).toBe(
      'משימה אחת באיחור',
    )
    expect(buildLeadGlanceFacts({ signals: merge({ overdueTaskCount: 3 }), statusTone: 'active' })[0]?.label).toBe(
      '3 משימות באיחור',
    )
  })

  it('due-today > open (overdue zero)', () => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ dueTodayTaskCount: 2, openTaskCount: 5 }),
      statusTone: 'active',
    })
    expect(facts[0]?.id).toBe('due-today')
    expect(facts[0]?.tone).toBe('attention')
  })

  it('open task is neutral, not attention', () => {
    const facts = buildLeadGlanceFacts({ signals: merge({ openTaskCount: 1 }), statusTone: 'active' })
    expect(facts[0]?.id).toBe('open')
    expect(facts[0]?.tone).toBe('neutral')
  })

  it('no-open + active status surfaces the "no open task" attention fact', () => {
    const facts = buildLeadGlanceFacts({ signals: merge({ openTaskCount: 0 }), statusTone: 'active' })
    expect(facts[0]?.id).toBe('no-open')
    expect(facts[0]?.tone).toBe('attention')
  })

  it('no-open + non-active does NOT surface the "no open task" fact', () => {
    const facts = buildLeadGlanceFacts({ signals: merge({ openTaskCount: 0 }), statusTone: 'cool' })
    // First fact slot is empty (no task pyramid match for non-active leads)
    expect(facts.find((f) => f.id === 'no-open')).toBeUndefined()
  })
})

describe('buildLeadGlanceFacts — silence buckets (second fact)', () => {
  it.each([
    [21, 'silence-long', 'urgent'],
    [25, 'silence-long', 'urgent'],
    [14, 'silence-medium', 'attention'],
    [20, 'silence-medium', 'attention'],
    [7, 'silence-short', 'neutral'],
    [13, 'silence-short', 'neutral'],
  ] as const)('%s days since last interaction → %s (%s)', (days, expectedId, expectedTone) => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ daysSinceLastInteraction: days, openTaskCount: 1 }),
      statusTone: 'active',
    })
    const silence = facts.find((f) => f.id === expectedId)
    expect(silence?.tone).toBe(expectedTone)
  })

  it.each([
    [0, 'נוצר קשר היום'],
    [1, 'נוצר קשר אתמול'],
  ])('%s days → recent-contact (%s)', (days, label) => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ daysSinceLastInteraction: days, openTaskCount: 1 }),
      statusTone: 'active',
    })
    const recent = facts.find((f) => f.id === 'recent-contact')
    expect(recent?.label).toBe(label)
    expect(recent?.tone).toBe('positive')
  })

  it('static-status fallback when no last interaction but long status duration', () => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ daysSinceLastInteraction: null, daysInCurrentStatus: 21, openTaskCount: 1 }),
      statusTone: 'cool',
    })
    expect(facts.find((f) => f.id === 'static-status')?.label).toBe('21 ימים באותו סטטוס')
  })

  it('static-status fact does NOT fire for terminal leads', () => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ daysSinceLastInteraction: null, daysInCurrentStatus: 30 }),
      statusTone: 'terminal',
    })
    expect(facts.find((f) => f.id === 'static-status')).toBeUndefined()
  })
})

describe('buildLeadGlanceFacts — output shape invariants', () => {
  it('caps facts at 2', () => {
    const facts = buildLeadGlanceFacts({
      signals: merge({ overdueTaskCount: 5, daysSinceLastInteraction: 30 }),
      statusTone: 'active',
    })
    expect(facts.length).toBeLessThanOrEqual(2)
  })

  it('returns empty array when nothing notable to say', () => {
    const facts = buildLeadGlanceFacts({ signals: baseSignals, statusTone: 'cool' })
    expect(facts).toEqual([])
  })
})
