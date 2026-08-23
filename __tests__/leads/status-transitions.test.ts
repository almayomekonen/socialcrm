import { describe, it, expect } from 'vitest'
import {
  buildTransitionInput,
  isRecordableTransition,
  type TransitionSource,
} from '@/db/leadStatusTransitions'

// Pure decision helpers for the lead status transition log. No DB — the write
// itself is exercised through the emitter's call sites; what matters here is
// that a no-op status write never manufactures history, and that a real move is
// captured with both ends intact.

describe('isRecordableTransition', () => {
  it('records a real move between two statuses', () => {
    expect(isRecordableTransition('new', 'contacted')).toBe(true)
  })

  it('records a first-ever status (null origin)', () => {
    expect(isRecordableTransition(null, 'new')).toBe(true)
    expect(isRecordableTransition(undefined, 'new')).toBe(true)
  })

  it('does NOT record a no-op (same status written again)', () => {
    expect(isRecordableTransition('contacted', 'contacted')).toBe(false)
  })

  it('treats surrounding whitespace as the same status', () => {
    expect(isRecordableTransition(' contacted ', 'contacted')).toBe(false)
  })

  it('does NOT record an empty or whitespace-only destination', () => {
    expect(isRecordableTransition('new', '')).toBe(false)
    expect(isRecordableTransition('new', '   ')).toBe(false)
  })
})

describe('buildTransitionInput', () => {
  const occurredAt = new Date('2026-08-24T09:00:00.000Z')

  const args = (over: Partial<Parameters<typeof buildTransitionInput>[0]> = {}) => ({
    agencyId: 7,
    leadId: 15015,
    previousStatus: 'new' as string | null | undefined,
    newStatus: 'contacted',
    occurredAt,
    actorUserId: 42 as number | null,
    source: 'manual' as TransitionSource,
    ...over,
  })

  it('carries every field and trims both ends', () => {
    expect(buildTransitionInput(args({ previousStatus: ' new ' }))).toEqual({
      agencyId: 7,
      leadId: 15015,
      fromStatus: 'new',
      toStatus: 'contacted',
      occurredAt,
      actorUserId: 42,
      source: 'manual',
    })
  })

  it('returns null for a no-op transition', () => {
    expect(buildTransitionInput(args({ previousStatus: 'contacted' }))).toBeNull()
  })

  it('records a null origin rather than dropping the row when the previous status is unknown', () => {
    const out = buildTransitionInput(args({ previousStatus: undefined, newStatus: 'lost' }))
    expect(out?.fromStatus).toBeNull()
    expect(out?.toStatus).toBe('lost')
  })

  it('normalises an empty-string origin to null', () => {
    expect(buildTransitionInput(args({ previousStatus: '' }))?.fromStatus).toBeNull()
  })

  it('accepts a null actor (system actor)', () => {
    expect(buildTransitionInput(args({ actorUserId: null }))?.actorUserId).toBeNull()
  })

  it('carries each source verbatim', () => {
    for (const source of ['manual', 'outcome', 'sale'] as TransitionSource[]) {
      expect(buildTransitionInput(args({ source }))?.source).toBe(source)
    }
  })

  it('rejects a non-positive leadId rather than writing an orphan row', () => {
    expect(buildTransitionInput(args({ leadId: 0 }))).toBeNull()
    expect(buildTransitionInput(args({ leadId: -1 }))).toBeNull()
  })

  it('rejects a non-positive agencyId — agency isolation is enforced at the persistence path', () => {
    expect(buildTransitionInput(args({ agencyId: 0 }))).toBeNull()
    expect(buildTransitionInput(args({ agencyId: -3 }))).toBeNull()
  })
})
