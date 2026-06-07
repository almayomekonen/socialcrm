import { describe, it, expect } from 'vitest'
import { splitUpcoming } from '@/lib/leads/upcomingFollowUps'

describe('splitUpcoming', () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => i)

  it('no overflow when rows <= limit', () => {
    expect(splitUpcoming(make(3), 10)).toEqual({ visible: [0, 1, 2], hasMore: false })
  })

  it('exactly limit rows → no overflow', () => {
    const r = splitUpcoming(make(10), 10)
    expect(r.visible).toHaveLength(10)
    expect(r.hasMore).toBe(false)
  })

  it('limit + 1 fetched → trims to limit and flags hasMore', () => {
    const r = splitUpcoming(make(11), 10)
    expect(r.visible).toHaveLength(10)
    expect(r.hasMore).toBe(true)
  })

  it('empty input', () => {
    expect(splitUpcoming([], 10)).toEqual({ visible: [], hasMore: false })
  })
})
