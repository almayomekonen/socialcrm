// Mobile Today — the v1/v2 PRESENTATION-MODEL NORMALISATION contract.
//
// The product runs two Today pipelines and a rollout flag decides which one an
// agency gets (`TODAY_BRIEF_V2`). Both feed one mobile screen, so both must
// produce the same SHAPE — hero + nextUp + rest — under one rule.
//
// WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT.
//
// It proves the partition is a pure regrouping: the same items, in the same
// order, with nothing lost, nothing duplicated and nothing promoted between
// sections. The central assertion is a single identity —
//
//     [...orderedSource]  ===  [hero, ...nextUp, ...rest]
//
// It does NOT assert anything about ranking, scoring, inclusion or exclusion.
// Those are decided upstream (`pickTopRecommended`, `mergeWaitingSpotlight`,
// `buildTodayBrief`) and are explicitly out of scope for the mobile layer: the
// view model receives already-ordered lists and is forbidden from reordering
// them. A test that asserted "the hottest lead is first" would be testing the
// recommender through the wrong seam.
//
// No DB, no clock: `modelFromSnapshot` takes `nowMs` as an argument and every
// reason string is precomputed server-side.

import { describe, test, expect } from 'vitest'
import { modelFromBrief, modelFromSnapshot, type MobileTodayModel } from '@/modules/today/mobile/viewModel'
import type { TodayBrief, BriefItem } from '@/lib/today/types'

const NOW = Date.parse('2026-08-18T09:00:00.000Z')

/** Flatten the three presentation buckets back into one ordered list. */
const flatten = (m: MobileTodayModel) => [...(m.hero ? [m.hero] : []), ...m.nextUp, ...m.rest]
const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

// ── v2 fixtures ─────────────────────────────────────────────────────────────

function briefItem(id: number, over: Partial<BriefItem> = {}): BriefItem {
  return {
    id,
    name: `ליד ${id}`,
    phone: `05000000${id.toString().padStart(2, '0')}`,
    state: 'OVERDUE_FOLLOWUP' as BriefItem['state'],
    reason: `סיבה ${id}`,
    targetSurface: 'lead' as BriefItem['targetSurface'],
    ...over,
  }
}

function brief(items: BriefItem[]): TodayBrief {
  return {
    greeting: 'בוקר טוב',
    firstName: 'אלמיהו',
    items,
    total: items.length,
    remaining: items.length,
    handledToday: 4,
    done: items.length === 0,
    volumeState: 'normal',
    statusVerdict: 'active',
    permissionVerdict: 'scoped_all_clear',
    meetings: [{ id: 1, title: 'פגישה', at: NOW }],
  }
}

// ── v1 fixtures ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dueRow = (id: number): any => ({
  id,
  name: `ליד ${id}`,
  phone: `05000000${id.toString().padStart(2, '0')}`,
  status: 'inProgress',
  leadSource: 'manual',
  nextFollowUpAt: new Date(NOW - 86_400_000).toISOString(),
  followUpNote: null,
  statusChangedAt: null,
  lastOutcomeType: null,
  lastActivityAt: null,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recommendation = (id: number, over: Record<string, unknown> = {}): any => ({
  lead: dueRow(id),
  reason: `סיבה ${id}`,
  ...over,
})

function snapshot(over: Record<string, unknown> = {}) {
  return {
    due: [],
    dueCount: 12,
    newLeadsCount: 5,
    upcomingCount: 2,
    doneToday: 4,
    meetings: [{ id: 1 }],
    recommended: [],
    tableRows: [],
    tableTotal: 9,
    progressPct: 25,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the partition is a pure regrouping (both pipelines)', () => {
  test('v2: hero + nextUp + rest is exactly brief.items, in order', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((i) => briefItem(i))
    const m = modelFromBrief(brief(items))

    expect(ids(flatten(m))).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(m.hero?.id).toBe(1)
    expect(ids(m.nextUp)).toEqual([2, 3])
    expect(ids(m.rest)).toEqual([4, 5, 6, 7])
  })

  test('v1: hero + nextUp + rest is exactly recommended ++ tableRows, in order', () => {
    const m = modelFromSnapshot(
      snapshot({
        recommended: [recommendation(1), recommendation(2), recommendation(3)],
        tableRows: [dueRow(4), dueRow(5), dueRow(6)],
      }),
      NOW,
    )

    expect(ids(flatten(m))).toEqual([1, 2, 3, 4, 5, 6])
    expect(m.hero?.id).toBe(1)
    expect(ids(m.nextUp)).toEqual([2, 3])
    expect(ids(m.rest)).toEqual([4, 5, 6])
  })

  test('no item is lost and none is duplicated, in either pipeline', () => {
    const v2 = modelFromBrief(brief([9, 8, 7, 6, 5].map((i) => briefItem(i))))
    const v1 = modelFromSnapshot(
      snapshot({
        recommended: [recommendation(9), recommendation(8), recommendation(7)],
        tableRows: [dueRow(6), dueRow(5)],
      }),
      NOW,
    )

    for (const m of [v2, v1]) {
      const flat = ids(flatten(m))
      expect(flat).toHaveLength(5)
      expect(new Set(flat).size).toBe(5) // no duplicates
      expect(flat).toEqual([9, 8, 7, 6, 5]) // source order preserved verbatim
    }
  })

  test('BOTH pipelines partition an equivalent source identically', () => {
    // Same five leads, same order, expressed in each pipeline's own shape.
    const v2 = modelFromBrief(brief([1, 2, 3, 4, 5].map((i) => briefItem(i))))
    const v1 = modelFromSnapshot(
      snapshot({
        recommended: [recommendation(1), recommendation(2), recommendation(3)],
        tableRows: [dueRow(4), dueRow(5)],
      }),
      NOW,
    )

    expect(v1.hero?.id).toBe(v2.hero?.id)
    expect(ids(v1.nextUp)).toEqual(ids(v2.nextUp))
    expect(ids(v1.rest)).toEqual(ids(v2.rest))
  })
})

describe('the partition is deterministic at every boundary size', () => {
  // The cut points are fixed: 1 hero, then at most 2 in nextUp, then the rest.
  const CASES: { n: number; hero: number | null; nextUp: number[]; rest: number[] }[] = [
    { n: 0, hero: null, nextUp: [], rest: [] },
    { n: 1, hero: 1, nextUp: [], rest: [] },
    { n: 2, hero: 1, nextUp: [2], rest: [] },
    { n: 3, hero: 1, nextUp: [2, 3], rest: [] },
    { n: 4, hero: 1, nextUp: [2, 3], rest: [4] },
    { n: 9, hero: 1, nextUp: [2, 3], rest: [4, 5, 6, 7, 8, 9] },
  ]

  for (const c of CASES) {
    test(`v2 with ${c.n} item(s)`, () => {
      const m = modelFromBrief(brief(Array.from({ length: c.n }, (_, i) => briefItem(i + 1))))
      expect(m.hero?.id ?? null).toBe(c.hero)
      expect(ids(m.nextUp)).toEqual(c.nextUp)
      expect(ids(m.rest)).toEqual(c.rest)
    })
  }

  test('nextUp never exceeds two, however long the source list is', () => {
    const m = modelFromBrief(brief(Array.from({ length: 40 }, (_, i) => briefItem(i + 1))))
    expect(m.nextUp).toHaveLength(2)
    expect(flatten(m)).toHaveLength(40)
  })

  /**
   * v1's `recommended` is capped at three upstream (`pickTopRecommended` ends in
   * `.slice(0, n)`, `mergeWaitingSpotlight` in `.slice(0, limit)`, both with
   * `recommendCount = 3`). This pins the consequence: a short `recommended` must
   * NOT pull rows up out of `tableRows` to fill "אחר כך", because that would move
   * an item between sections rather than regroup it.
   */
  test('v1: a short recommended list does not promote tableRows into nextUp', () => {
    const m = modelFromSnapshot(
      snapshot({ recommended: [recommendation(1)], tableRows: [dueRow(2), dueRow(3)] }),
      NOW,
    )
    expect(m.hero?.id).toBe(1)
    expect(m.nextUp).toEqual([]) // NOT [2]
    expect(ids(m.rest)).toEqual([2, 3])
    expect(ids(flatten(m))).toEqual([1, 2, 3]) // still lossless and ordered
  })
})

describe('empty states stay correct', () => {
  test('v2: an empty brief yields an empty model, not a phantom hero', () => {
    const m = modelFromBrief(brief([]))
    expect(m.hero).toBeNull()
    expect(m.nextUp).toEqual([])
    expect(m.rest).toEqual([])
    expect(m.restTotal).toBe(0)
    expect(m.source).toBe('brief_v2')
  })

  test('v1: an empty snapshot yields an empty model', () => {
    const m = modelFromSnapshot(snapshot({ recommended: [], tableRows: [], tableTotal: 0, dueCount: 0 }), NOW)
    expect(m.hero).toBeNull()
    expect(m.nextUp).toEqual([])
    expect(m.rest).toEqual([])
    expect(m.source).toBe('worklist_v1')
  })

  test('v1: rows with no recommendation still render as the rest list', () => {
    // hero is null but the screen is NOT empty — the clear-state must not show.
    const m = modelFromSnapshot(snapshot({ recommended: [], tableRows: [dueRow(7), dueRow(8)] }), NOW)
    expect(m.hero).toBeNull()
    expect(ids(m.rest)).toEqual([7, 8])
  })
})

describe('counts are passed through untouched', () => {
  test('v2 carries the brief’s own counts', () => {
    const m = modelFromBrief(brief([1, 2, 3, 4, 5].map((i) => briefItem(i))))
    expect(m.remaining).toBe(5)
    expect(m.doneToday).toBe(4)
    expect(m.meetings).toBe(1)
    // 5 items - (hero + 2) = 2 still listed below.
    expect(m.restTotal).toBe(2)
  })

  test('v1 carries the snapshot’s own counts, including the TRUE rest total', () => {
    const m = modelFromSnapshot(
      snapshot({
        recommended: [recommendation(1)],
        tableRows: [dueRow(2)],
        tableTotal: 87, // server total — deliberately larger than the page shown
        dueCount: 88,
      }),
      NOW,
    )
    expect(m.remaining).toBe(88)
    expect(m.restTotal).toBe(87)
    expect(m.newLeadsCount).toBe(5)
    // This is the case that makes the "מוצגים X מתוך Y" honesty line appear.
    expect(m.restTotal).toBeGreaterThan(m.rest.length)
  })
})

describe('row mapping preserves routing and identity', () => {
  test('a conversation item routes to the inbox thread and is flagged as one', () => {
    const m = modelFromBrief(
      brief([briefItem(1, { conversationId: 42, href: '/inbox?conversation=42', waitingFor: 'ממתין 6 ימים' })]),
    )
    expect(m.hero?.href).toBe('/inbox?conversation=42')
    expect(m.hero?.cta).toBe('open_conversation')
    // `waitingFor` wins over `reason` when present — unchanged behaviour.
    expect(m.hero?.reason).toBe('ממתין 6 ימים')
  })

  test('a plain lead item routes to the lead summary with no conversation CTA', () => {
    const m = modelFromBrief(brief([briefItem(3)]))
    expect(m.hero?.href).toBe('/clients/3/summary')
    expect(m.hero?.cta).toBeUndefined()
  })

  test('v1 rows keep the lead id, which is what the contact actions need', () => {
    const m = modelFromSnapshot(snapshot({ recommended: [recommendation(11)], tableRows: [dueRow(12)] }), NOW)
    expect(m.hero?.id).toBe(11)
    expect(m.hero?.phone).toBe('0500000011')
    expect(m.rest[0].id).toBe(12)
  })
})
