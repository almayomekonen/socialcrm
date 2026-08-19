// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { emptyState, parseState, readState, recordTour, storageKey, writeState } from '@/lib/education/storage'

afterEach(() => {
  window.localStorage.clear()
})

describe('parseState', () => {
  it('returns empty for null, garbage, and the wrong shape', () => {
    expect(parseState(null)).toEqual(emptyState())
    expect(parseState('not-json')).toEqual(emptyState())
    expect(parseState('{"tours":"nope"}')).toEqual(emptyState())
    expect(parseState('{"tours":{"pipeline":{"version":"x"}}}')).toEqual(emptyState())
  })

  it('keeps only well-formed tour records', () => {
    const parsed = parseState(
      JSON.stringify({
        tours: {
          pipeline: { version: 1, status: 'completed', at: '2026-08-01T00:00:00.000Z', lastStep: 2 },
          lead: { version: 1, status: 'nope', at: 'x' },
        },
      }),
    )
    expect(parsed.tours.pipeline).toEqual({
      version: 1,
      status: 'completed',
      at: '2026-08-01T00:00:00.000Z',
      lastStep: 2,
    })
    expect(parsed.tours.lead).toBeUndefined()
  })
})

describe('read/write', () => {
  it('persists a dismiss so a later read still sees it', () => {
    const userId = 42
    expect(readState(userId)).toEqual(emptyState())
    const next = recordTour(emptyState(), 'pipeline', 1, 'dismissed', 0)
    writeState(userId, next)
    expect(window.localStorage.getItem(storageKey(userId))).toContain('dismissed')
    expect(readState(userId).tours.pipeline?.status).toBe('dismissed')
    expect(readState(userId).tours.pipeline?.version).toBe(1)
  })

  it('scopes state per user', () => {
    writeState(1, recordTour(emptyState(), 'pipeline', 1, 'completed'))
    expect(readState(2).tours.pipeline).toBeUndefined()
    expect(readState(1).tours.pipeline?.status).toBe('completed')
  })
})
