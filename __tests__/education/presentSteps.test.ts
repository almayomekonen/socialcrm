import { describe, expect, it } from 'vitest'
import { isLeadOpenSelector, isLeadsWorkspaceEmpty, isNavEduSelector, presentSteps, waitForLeadsWorkspaceEmpty, waitForTourTargets } from '@/lib/education/presentSteps'
import type { TourStep } from '@/lib/education/types'

const steps: TourStep[] = [
  { element: '[data-edu="a"]', title: 'A', description: 'a' },
  { element: '[data-edu="b"]', title: 'B', description: 'b' },
  { title: 'Untargeted', description: 'ok without a node' },
]

describe('presentSteps', () => {
  it('keeps steps whose target exists and drops the rest', () => {
    const query = (sel: string) => (sel.includes('"a"') ? ({} as Element) : null)
    const present = presentSteps(steps, query)
    expect(present.map((s) => s.title)).toEqual(['A', 'Untargeted'])
  })

  it('returns an empty list when every targeted step is missing', () => {
    expect(presentSteps(steps.slice(0, 2), () => null)).toEqual([])
  })

  it('does not query the document when a custom query is provided (SSR-safe)', () => {
    const present = presentSteps(steps, () => null)
    expect(present).toHaveLength(1)
    expect(present[0].title).toBe('Untargeted')
  })
})

describe('waitForTourTargets', () => {
  it('resolves true immediately when a target already exists', async () => {
    const query = (sel: string) => (sel.includes('"a"') ? ({} as Element) : null)
    let scheduled = 0
    const ready = await waitForTourTargets(steps, {
      query,
      schedule: (cb) => {
        scheduled += 1
        cb()
        return 1
      },
    })
    expect(ready).toBe(true)
    expect(scheduled).toBe(0)
  })

  it('resolves true on a later frame when the target appears', async () => {
    let found = false
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(steps.slice(0, 1), {
      query: () => (found ? ({} as Element) : null),
      timeoutMs: 1000,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return queue.length
      },
    })
    expect(queue).toHaveLength(1)
    found = true
    t += 16
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })

  it('resolves false after the timeout when targets never appear', async () => {
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(steps.slice(0, 2), {
      query: () => null,
      timeoutMs: 40,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return 1
      },
    })
    expect(queue).toHaveLength(1)
    t = 40
    queue.shift()?.()
    await expect(pending).resolves.toBe(false)
  })

  it('stops waiting when aborted', async () => {
    const signal = AbortSignal.abort()
    await expect(waitForTourTargets(steps.slice(0, 2), { query: () => null, signal })).resolves.toBe(false)
  })

  it('waits for a navigation target even when an untargeted intro step exists', async () => {
    let t = 0
    let scheduled = 0
    const queue: Array<() => void> = []
    const pending = waitForTourTargets(steps, {
      query: () => null,
      timeoutMs: 40,
      now: () => t,
      schedule: (cb) => {
        scheduled += 1
        queue.push(cb)
        return 1
      },
    })
    expect(scheduled).toBe(1)
    t = 40
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })

  it('omits a permission-hidden nav item and keeps siblings that exist', () => {
    const query = (sel: string) => (sel.includes('nav-today') ? null : ({} as Element))
    const overviewish: TourStep[] = [
      { element: '[data-edu="nav-today"]', title: 'Today', description: 'home' },
      { element: '[data-edu="nav-leads"]', title: 'Leads', description: 'list' },
      { element: '[data-edu="header"]', title: 'Header', description: 'top' },
      { title: 'Done', description: 'ok' },
    ]
    expect(presentSteps(overviewish, query).map((s) => s.title)).toEqual(['Leads', 'Header', 'Done'])
  })

  it('does not treat the generic rail selector as a nav item', () => {
    expect(isNavEduSelector('[data-edu="nav"]')).toBe(false)
    expect(isNavEduSelector('[data-edu="nav-today"]')).toBe(true)
    expect(isNavEduSelector('[data-edu="header"]')).toBe(false)
    expect(isLeadOpenSelector('[data-edu="lead-open"]')).toBe(true)
    expect(isLeadOpenSelector('[data-edu="leads-table"]')).toBe(false)
  })
})

describe('leads workspace empty detection', () => {
  const el = () => ({}) as Element

  it('treats the first-run marker as empty, not a filtered table', () => {
    const query = (sel: string) => (sel === '[data-leads-empty]' ? el() : null)
    expect(isLeadsWorkspaceEmpty(query)).toBe(true)
  })

  it('is not empty when the leads table exists without a visible row', () => {
    const query = (sel: string) => (sel === '[data-edu="leads-table"]' || sel === '[data-edu="leads-add"]' ? el() : null)
    expect(isLeadsWorkspaceEmpty(query)).toBe(false)
  })

  it('resolves empty immediately when the first-run marker is present', async () => {
    await expect(
      waitForLeadsWorkspaceEmpty({
        query: (sel) => (sel === '[data-leads-empty]' ? el() : null),
        schedule: () => 1,
      }),
    ).resolves.toBe(true)
  })

  it('resolves not-empty immediately when the table exists', async () => {
    await expect(
      waitForLeadsWorkspaceEmpty({
        query: (sel) => (sel === '[data-edu="leads-table"]' ? el() : null),
        schedule: () => 1,
      }),
    ).resolves.toBe(false)
  })

  it('resolves empty after timeout when no list targets appear', async () => {
    let t = 0
    const queue: Array<() => void> = []
    const pending = waitForLeadsWorkspaceEmpty({
      query: () => null,
      timeoutMs: 40,
      now: () => t,
      schedule: (cb) => {
        queue.push(cb)
        return 1
      },
    })
    expect(queue).toHaveLength(1)
    t = 40
    queue.shift()?.()
    await expect(pending).resolves.toBe(true)
  })
})
