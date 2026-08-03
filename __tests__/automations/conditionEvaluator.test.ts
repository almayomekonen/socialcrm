import { describe, expect, it } from 'vitest'
import {
  conditionsWithFreshness,
  evaluateCondition,
  evaluateConditions,
  liveConditionsHold,
  liveFieldKeys,
  snapshotConditionsMatch,
} from '@/lib/automations/conditionEvaluator'
import { getEvent } from '@/lib/automations/catalog/registry'
import { CONDITION_OPERATORS, OPERATORS_BY_FIELD_TYPE } from '@/lib/automations/catalog/vocabularies'
import type { Condition } from '@/lib/automations/conditions'
import type { EventDefinition, FieldDefinition } from '@/lib/automations/catalog/types'

/**
 * B6 — the general condition evaluator.
 *
 * Two things are under test: that it evaluates ANY catalog-described condition
 * from metadata alone, and that for the two conditions production actually has
 * it is indistinguishable from the legacy projection it replaced.
 */

const CREATED = getEvent('lead.created') as EventDefinition
const STATUS_CHANGED = getEvent('lead.status_changed') as EventDefinition

const field = (over: Partial<FieldDefinition> = {}): FieldDefinition =>
  ({ key: 'f', type: 'text', label: 'שדה', freshness: 'live', lifecycle: 'stable', ...over }) as FieldDefinition

const cond = (over: Partial<Condition> = {}): Condition => ({ field: 'f', operator: 'is', value: '', ...over }) as Condition

describe('operators — every one in the vocabulary has a meaning', () => {
  it('no operator is silently unimplemented', () => {
    for (const operator of CONDITION_OPERATORS) {
      const result = evaluateCondition(field(), cond({ operator, value: 'x' }), 'x')
      expect(result, `operator "${operator}" has no evaluator`).not.toBeUndefined()
    }
  })

  it('text: is / is_not / contains', () => {
    const f = field({ type: 'text' })
    expect(evaluateCondition(f, cond({ operator: 'is', value: 'abc' }), 'abc')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'is', value: 'abc' }), 'abd')).toBe(false)
    expect(evaluateCondition(f, cond({ operator: 'is_not', value: 'abc' }), 'abd')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'contains', value: 'bc' }), 'abcd')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'contains', value: 'zz' }), 'abcd')).toBe(false)
  })

  it('enum: is / is_not / is_one_of', () => {
    const f = field({ type: 'enum' })
    expect(evaluateCondition(f, cond({ operator: 'is_one_of', value: 'a, b ,c' }), 'b')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'is_one_of', value: 'a,b' }), 'z')).toBe(false)
  })

  it('numeric: equals / greater_than / less_than, coercing strings', () => {
    const f = field({ type: 'number' })
    expect(evaluateCondition(f, cond({ operator: 'greater_than', value: '10' }), 11)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'greater_than', value: '10' }), '11')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'less_than', value: '10' }), 9)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'equals', value: '10' }), 10)).toBe(true)
  })

  it('temporal: before / after / between', () => {
    const f = field({ type: 'datetime' })
    const at = new Date('2026-08-02T12:00:00Z')
    expect(evaluateCondition(f, cond({ operator: 'before', value: '2026-08-03T00:00:00Z' }), at)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'after', value: '2026-08-01T00:00:00Z' }), at)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'between', value: '2026-08-01T00:00:00Z,2026-08-03T00:00:00Z' }), at)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'between', value: '2026-08-03T00:00:00Z,2026-08-04T00:00:00Z' }), at)).toBe(
      false,
    )
  })

  it('presence: exists / not_exists treat blank as absent', () => {
    const f = field({ type: 'email' })
    expect(evaluateCondition(f, cond({ operator: 'exists' }), 'a@b.co')).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'exists' }), '   ')).toBe(false)
    expect(evaluateCondition(f, cond({ operator: 'exists' }), null)).toBe(false)
    expect(evaluateCondition(f, cond({ operator: 'not_exists' }), null)).toBe(true)
  })

  it('boolean: is_true / is_false', () => {
    const f = field({ type: 'boolean' })
    expect(evaluateCondition(f, cond({ operator: 'is_true' }), true)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'is_false' }), false)).toBe(true)
    expect(evaluateCondition(f, cond({ operator: 'is_true' }), false)).toBe(false)
  })

  it('every operator a field TYPE offers is decidable for a sensible value', () => {
    const samples: Record<string, unknown> = {
      text: 'abc',
      number: 5,
      money: 5,
      boolean: true,
      enum: 'a',
      date: '2026-08-02',
      datetime: '2026-08-02T12:00:00Z',
      email: 'a@b.co',
      phone: '0500000000',
      url: 'https://x.example',
      reference: 'r1',
    }
    // The expected value must be of the operator's own kind — a numeric
    // operator given "a" is CORRECTLY undecidable, which is asserted above.
    const expectedFor = (operator: string): string => {
      if (operator === 'between') return '2026-08-01,2026-08-03'
      if (['equals', 'greater_than', 'less_than'].includes(operator)) return '1'
      if (['before', 'after'].includes(operator)) return '2026-08-02T00:00:00Z'
      return 'a'
    }
    for (const [type, operators] of Object.entries(OPERATORS_BY_FIELD_TYPE)) {
      for (const operator of operators) {
        const result = evaluateCondition(
          field({ type: type as never }),
          cond({ operator, value: expectedFor(operator) }),
          samples[type],
        )
        expect(result, `${type} · ${operator} was undecidable`).not.toBe(null)
      }
    }
  })
})

describe('Law 3 — undecidable is never a silent pass', () => {
  it('an unknown field fails the set and names itself', () => {
    const verdict = evaluateConditions(CREATED, [cond({ field: 'nope', operator: 'is', value: 'x' })], {})
    expect(verdict).toEqual({ pass: false, undecidable: 'nope' })
  })

  it('a non-numeric value under a numeric operator is undecidable, not false-y', () => {
    expect(evaluateCondition(field({ type: 'number' }), cond({ operator: 'greater_than', value: 'x' }), 5)).toBe(null)
  })

  it('an unparseable date under a temporal operator is undecidable', () => {
    expect(evaluateCondition(field({ type: 'datetime' }), cond({ operator: 'before', value: 'soon' }), 1)).toBe(null)
  })

  it('an empty condition set passes — narrowing nothing means matching everything', () => {
    expect(evaluateConditions(CREATED, [], {})).toEqual({ pass: true, undecidable: null })
  })

  it('AND-only: one failure fails the set', () => {
    const verdict = evaluateConditions(
      CREATED,
      [
        { field: 'source', operator: 'contains', value: 'facebook' },
        { field: 'status', operator: 'is', value: 'new' },
      ],
      { source: 'facebook:1', status: 'contacted' },
    )
    expect(verdict.pass).toBe(false)
  })
})

describe('freshness decides WHERE a condition is evaluated', () => {
  const conditions: Condition[] = [
    { field: 'source', operator: 'contains', value: 'facebook' }, // snapshot
    { field: 'status', operator: 'is', value: 'new' }, // live
  ]

  it('partitions by the field’s declared freshness, and the partition is total', () => {
    const snap = conditionsWithFreshness(CREATED, conditions, 'snapshot')
    const live = conditionsWithFreshness(CREATED, conditions, 'live')
    expect(snap.map((c) => c.field)).toEqual(['source'])
    expect(live.map((c) => c.field)).toEqual(['status'])
    expect(snap.length + live.length).toBe(conditions.length)
  })

  it('emission decides ONLY snapshot conditions — a stale live value is never read early', () => {
    // status is deliberately absent from the emission payload.
    expect(snapshotConditionsMatch(CREATED, conditions, { source: 'facebook:1' }).pass).toBe(true)
    expect(snapshotConditionsMatch(CREATED, conditions, { source: 'whatsapp:1' }).pass).toBe(false)
  })

  it('execution decides ONLY live conditions — the snapshot was already settled', () => {
    expect(liveConditionsHold(CREATED, conditions, { status: 'new' }).pass).toBe(true)
    expect(liveConditionsHold(CREATED, conditions, { status: 'closed' }).pass).toBe(false)
  })

  it('reports exactly which live fields must be fetched, so callers query no more', () => {
    expect(liveFieldKeys(CREATED, conditions)).toEqual(['status'])
    expect(liveFieldKeys(CREATED, [conditions[0]])).toEqual([])
  })

  it('a snapshot field is never re-read live, so a delayed send cannot change its answer', () => {
    const later = { source: 'whatsapp:1', status: 'new' }
    expect(liveConditionsHold(CREATED, [conditions[0]], later).pass).toBe(true)
  })
})

describe('byte-identity — the deleted legacy projection, reproduced', () => {
  /** The exact implementation B6 deleted from laws.ts, kept here as an oracle. */
  const legacySourceFilterMatches = (filter: string | null, leadSource: string | null | undefined): boolean => {
    if (filter == null || filter.trim() === '') return true
    if (!leadSource) return false
    return leadSource === filter || leadSource.startsWith(`${filter}:`)
  }

  /** Every shape `clients.leadSource` can hold: `provider:id`, or null. */
  const SOURCES = ['facebook:123', 'facebook:999999', 'whatsapp:wamid.abc', 'whatsapp:9', null, undefined]
  const FILTERS = ['facebook', 'whatsapp', 'instagram']

  it('`source contains X` agrees with sourceFilterMatches on every real value', () => {
    for (const filter of FILTERS) {
      for (const source of SOURCES) {
        const legacy = legacySourceFilterMatches(filter, source)
        const evaluated = snapshotConditionsMatch(CREATED, [{ field: 'source', operator: 'contains', value: filter }], {
          source: source ?? null,
        }).pass
        expect(evaluated, `filter=${filter} source=${String(source)}`).toBe(legacy)
      }
    }
  })

  it('an absent filter matched everything; an absent condition set does too', () => {
    expect(legacySourceFilterMatches(null, 'facebook:1')).toBe(true)
    expect(snapshotConditionsMatch(CREATED, [], { source: 'facebook:1' }).pass).toBe(true)
  })

  /** The exact premise branch B6 deleted from universalGuards. */
  const legacyPremiseExpired = (expected: string | null, current: string | null): boolean =>
    expected != null && current !== expected

  it('`status is X` (live) reproduces the premise-expiry comparison exactly', () => {
    const STATUSES = ['new', 'contacted', 'interested', 'closed', 'lost', null]
    for (const expected of ['contacted', 'closed']) {
      for (const current of STATUSES) {
        const legacyExpired = legacyPremiseExpired(expected, current)
        const holds = liveConditionsHold(STATUS_CHANGED, [{ field: 'status', operator: 'is', value: expected }], {
          status: current,
        }).pass
        expect(holds, `expected=${expected} current=${String(current)}`).toBe(!legacyExpired)
      }
    }
  })
})

describe('a condition on an unknown field belongs to NO partition — and must not vanish', () => {
  const unknown: Condition[] = [{ field: 'invented', operator: 'is', value: 'x' }]

  it('is dropped by both freshness partitions', () => {
    expect(conditionsWithFreshness(CREATED, unknown, 'snapshot')).toEqual([])
    expect(conditionsWithFreshness(CREATED, unknown, 'live')).toEqual([])
  })

  it('is nevertheless caught at emission', () => {
    expect(snapshotConditionsMatch(CREATED, unknown, {})).toEqual({ pass: false, undecidable: 'invented' })
  })

  it('and again at execution — defence in depth, because execution is the last gate', () => {
    expect(liveConditionsHold(CREATED, unknown, {})).toEqual({ pass: false, undecidable: 'invented' })
  })

  it('a valid condition alongside an unknown one still fails the whole set', () => {
    const mixed: Condition[] = [{ field: 'source', operator: 'contains', value: 'facebook' }, ...unknown]
    expect(snapshotConditionsMatch(CREATED, mixed, { source: 'facebook:1' }).pass).toBe(false)
  })
})
