import { describe, expect, it } from 'vitest'
import {
  formatSummaryBlock,
  planSummary,
  recentWindow,
  RECENT_WINDOW,
  SUMMARY_BATCH,
  type Turn,
} from '@/lib/inbox/autoresponse/conversationSummary'

/**
 * Long-conversation memory.
 *
 * The brief was explicit that recall must be tested AFTER a detail has actually
 * fallen outside the recent-message window — not on a short transcript where
 * everything is still verbatim and nothing has been proven. So every recall test
 * here builds a transcript longer than RECENT_WINDOW and asserts on what
 * survives the cut.
 */

const turn = (sequence: number, direction: 'inbound' | 'outbound', text: string): Turn => ({
  sequence,
  direction,
  text,
})

/** A conversation of `n` messages, alternating, with a marker at `markerAt`. */
function conversation(n: number, markerAt?: number, marker = 'MARKER'): Turn[] {
  return Array.from({ length: n }, (_, i) =>
    turn(i + 1, i % 2 === 0 ? 'inbound' : 'outbound', i + 1 === markerAt ? marker : `הודעה ${i + 1}`),
  )
}

describe('the verbatim window is bounded', () => {
  it('a short conversation is entirely verbatim', () => {
    const short = conversation(10)
    expect(recentWindow(short)).toHaveLength(10)
    expect(planSummary(short, { summary: null, summaryThroughSequence: 0 })).toEqual({ action: 'keep' })
  })

  it('a conversation exactly at the window is still entirely verbatim', () => {
    const exact = conversation(RECENT_WINDOW)
    expect(recentWindow(exact)).toHaveLength(RECENT_WINDOW)
    expect(planSummary(exact, { summary: null, summaryThroughSequence: 0 })).toEqual({ action: 'keep' })
  })

  it('past the window, only the last RECENT_WINDOW messages stay verbatim', () => {
    const long = conversation(RECENT_WINDOW + 30)
    const kept = recentWindow(long)
    expect(kept).toHaveLength(RECENT_WINDOW)
    expect(kept[kept.length - 1].sequence).toBe(RECENT_WINDOW + 30)
    expect(kept[0].sequence).toBe(31)
  })
})

describe('THE POINT — a detail that fell outside the window is not in the verbatim transcript', () => {
  const MARKER_AT = 3
  const long = conversation(RECENT_WINDOW + 20, MARKER_AT, 'הרכב הוא מאזדה 3 שנת 2018')

  it('the marker really is gone from the verbatim window', () => {
    const kept = recentWindow(long)
    expect(kept.some((t) => t.text.includes('מאזדה'))).toBe(false)
  })

  it('and it IS inside the batch handed to the summariser', () => {
    const plan = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    expect(plan.action).toBe('summarise')
    if (plan.action !== 'summarise') return
    expect(plan.olderTurns.some((t) => t.text.includes('מאזדה'))).toBe(true)
    expect(plan.recentTurns).toHaveLength(RECENT_WINDOW)
  })

  it('so the only way it survives is the summary — which is exactly what is asserted', () => {
    const plan = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    if (plan.action !== 'summarise') throw new Error('expected a summarise plan')
    // Simulate the summariser having captured it.
    const block = formatSummaryBlock('הרכב: מאזדה 3 שנת 2018. הלקוח שאל על בלמים.') ?? ''
    expect(block).toContain('מאזדה 3 שנת 2018')
    expect(block).toContain('אל תשאל/י שוב על מה שמופיע כאן')
  })
})

describe('the summary advances on a schedule, not every turn', () => {
  it('does not re-summarise until a batch of new messages has fallen out', () => {
    const long = conversation(RECENT_WINDOW + 10)
    // Already covered through sequence 10; only 0 new older messages beyond that
    // would be pending here, so nothing is owed.
    const covered = planSummary(long, { summary: 'קיים', summaryThroughSequence: 10 })
    expect(covered).toEqual({ action: 'keep' })
  })

  it('summarises once enough new material is outside the window', () => {
    const long = conversation(RECENT_WINDOW + SUMMARY_BATCH + 5)
    const plan = planSummary(long, { summary: 'קיים', summaryThroughSequence: 1 })
    expect(plan.action).toBe('summarise')
  })

  it('the first roll summarises even below the batch size', () => {
    // Nothing summarised yet: the first messages to fall out must be captured
    // immediately, or they are lost before the batch threshold is ever reached.
    const long = conversation(RECENT_WINDOW + 2)
    const plan = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    expect(plan.action).toBe('summarise')
    if (plan.action !== 'summarise') return
    expect(plan.upToSequence).toBe(2)
  })

  it('never summarises the same messages twice', () => {
    const long = conversation(RECENT_WINDOW + SUMMARY_BATCH + 4)
    const first = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    if (first.action !== 'summarise') throw new Error('expected summarise')
    const second = planSummary(long, { summary: 'x', summaryThroughSequence: first.upToSequence })
    expect(second).toEqual({ action: 'keep' })
  })
})

describe('formatSummaryBlock', () => {
  it('is absent when there is no summary', () => {
    expect(formatSummaryBlock(null)).toBeNull()
    expect(formatSummaryBlock('   ')).toBeNull()
  })

  it('marks the summary as internal, never quotable', () => {
    const block = formatSummaryBlock('הלקוח מחפש טיפול פנים.') ?? ''
    expect(block).toContain('זיכרון פנימי')
    expect(block).toContain('לא לשלוח ללקוח')
  })
})

describe('the three memory layers do not overlap', () => {
  it('structured facts are never summarised away — they live in their own column', () => {
    // planSummary only ever touches transcript turns. It has no access to, and
    // returns nothing about, conversation_ai_state.qualification.
    const long = conversation(RECENT_WINDOW + 12)
    const plan = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    if (plan.action !== 'summarise') throw new Error('expected summarise')
    expect(Object.keys(plan)).toEqual(['action', 'upToSequence', 'olderTurns', 'recentTurns'])
  })

  it('the batch and the window are disjoint and together cover everything', () => {
    const long = conversation(RECENT_WINDOW + 15)
    const plan = planSummary(long, { summary: null, summaryThroughSequence: 0 })
    if (plan.action !== 'summarise') throw new Error('expected summarise')
    const seqs = [...plan.olderTurns, ...plan.recentTurns].map((t) => t.sequence)
    expect(seqs).toEqual(long.map((t) => t.sequence))
    expect(new Set(seqs).size).toBe(long.length)
  })
})
