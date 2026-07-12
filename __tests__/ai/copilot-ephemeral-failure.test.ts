import { describe, expect, it } from 'vitest'
import {
  asErrorReason,
  createOptimisticFailedEntry,
  shouldKeepEphemeralFailed,
  type AssistantFailedEntry,
  type TimelineEntry,
} from '@/lib/copilot/timeline'

function persistedFailed(id: number, actionId: AssistantFailedEntry['actionId'] = 'ask-question'): AssistantFailedEntry {
  return {
    kind: 'assistant-failed',
    id,
    sequence: id,
    createdAt: new Date().toISOString(),
    source: 'persisted',
    actionId,
    errorReason: 'unknown',
    mode: null,
  }
}

describe('copilot ephemeral failure (Wave A9)', () => {
  it('maps known and unknown error reasons', () => {
    expect(asErrorReason('over-quota')).toBe('over-quota')
    expect(asErrorReason('all-providers-failed')).toBe('all-providers-failed')
    expect(asErrorReason('nope')).toBe('unknown')
    expect(asErrorReason(null)).toBe('unknown')
  })

  it('creates an optimistic assistant-failed entry', () => {
    const entry = createOptimisticFailedEntry('draft-followup-message', 'invalid-input')
    expect(entry.kind).toBe('assistant-failed')
    expect(entry.source).toBe('optimistic')
    expect(entry.actionId).toBe('draft-followup-message')
    expect(entry.errorReason).toBe('invalid-input')
    expect(String(entry.id)).toMatch(/^opt-fail-draft-followup-message-/)
  })

  it('keeps ephemeral failure when refetch adds nothing new', () => {
    const prev: TimelineEntry[] = []
    const ephemeral = createOptimisticFailedEntry('ask-question', 'unknown')
    expect(shouldKeepEphemeralFailed(prev, prev, ephemeral)).toBe(true)
  })

  it('drops ephemeral failure when refetch hydrates a new persisted failed row', () => {
    const prev: TimelineEntry[] = []
    const ephemeral = createOptimisticFailedEntry('ask-question', 'unknown')
    const next: TimelineEntry[] = [persistedFailed(42, 'conversational')]
    expect(shouldKeepEphemeralFailed(prev, next, ephemeral)).toBe(false)
  })

  it('keeps ephemeral when only older persisted failures exist', () => {
    const old = persistedFailed(10, 'next-best-step')
    const prev: TimelineEntry[] = [old]
    const ephemeral = createOptimisticFailedEntry('ask-question', 'unknown')
    expect(shouldKeepEphemeralFailed(prev, prev, ephemeral)).toBe(true)
  })

  it('returns false when ephemeral is null', () => {
    expect(shouldKeepEphemeralFailed([], [], null)).toBe(false)
  })
})
