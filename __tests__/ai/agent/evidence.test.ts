import { describe, expect, it } from 'vitest'
import { createEvidenceCollector } from '@/lib/agent/evidence'

/**
 * Tools push evidence as a side effect of returning data; the model never
 * writes to the collector, so it cannot manufacture a citation. The validator
 * later checks every claim against what is in here.
 *
 * Pure — no I/O.
 */

describe('evidence collector — recording and lookup', () => {
  it('records and looks up a lead ref', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'lead', refId: '15015' })
    expect(c.has('lead', '15015')).toBe(true)
    expect(c.has('lead', '99')).toBe(false)
  })

  it('starts empty', () => {
    const c = createEvidenceCollector()
    expect(c.size()).toBe(0)
    expect(c.all()).toEqual([])
    expect(c.has('lead', '1')).toBe(false)
    expect(c.hasMetric('anything')).toBe(false)
  })

  it('returns every recorded ref', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'lead', refId: '1' })
    c.add({ kind: 'conversation', refId: '2' })
    expect(c.all()).toHaveLength(2)
  })
})

describe('evidence collector — deduplication', () => {
  it('deduplicates identical refs', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'lead', refId: '15015' })
    c.add({ kind: 'lead', refId: '15015' })
    expect(c.size()).toBe(1)
  })

  it('keeps refs of different kinds with the same id distinct', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'lead', refId: '7' })
    c.add({ kind: 'conversation', refId: '7' })
    c.add({ kind: 'message', refId: '7' })
    expect(c.size()).toBe(3)
    expect(c.has('conversation', '7')).toBe(true)
    expect(c.has('message', '7')).toBe(true)
  })

  it('deduplicates a metric by name and window, not by sample size', () => {
    const c = createEvidenceCollector()
    const window = { from: 'a', to: 'b' }
    c.add({ kind: 'metric', metric: 'today.total', window, n: 3 })
    c.add({ kind: 'metric', metric: 'today.total', window, n: 4 })
    expect(c.size()).toBe(1)
  })

  it('treats the same metric over a different window as distinct evidence', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'metric', metric: 'today.total', window: { from: 'a', to: 'b' }, n: 3 })
    c.add({ kind: 'metric', metric: 'today.total', window: { from: 'c', to: 'd' }, n: 9 })
    expect(c.size()).toBe(2)
  })
})

describe('evidence collector — metric lookup', () => {
  it('records a metric ref with its window and sample size', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'metric', metric: 'today.waiting_reply', window: { from: 'a', to: 'b' }, n: 4 })
    expect(c.hasMetric('today.waiting_reply')).toBe(true)
    expect(c.hasMetric('today.overdue')).toBe(false)
  })

  it('a metric name is not matched by the entity lookup, and vice versa', () => {
    const c = createEvidenceCollector()
    c.add({ kind: 'metric', metric: 'today.total', window: { from: 'a', to: 'b' }, n: 1 })
    c.add({ kind: 'lead', refId: 'today.total' })
    expect(c.hasMetric('today.total')).toBe(true)
    expect(c.has('lead', 'today.total')).toBe(true)
    expect(c.size()).toBe(2)
  })
})

describe('evidence collector — isolation between investigations', () => {
  it('two collectors never share state', () => {
    const a = createEvidenceCollector()
    const b = createEvidenceCollector()
    a.add({ kind: 'lead', refId: '15015' })
    expect(b.size()).toBe(0)
    expect(b.has('lead', '15015')).toBe(false)
  })
})
