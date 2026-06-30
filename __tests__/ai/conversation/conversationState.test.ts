import { describe, it, expect } from 'vitest'
import { toConversationState } from '@/lib/copilot/general/conversationState'

const reasoned = (over: Record<string, unknown> = {}) => ({
  kind: 'reasoned',
  allClear: false,
  executiveDecision: 'התחל מגיא מלכה.',
  actions: [{ action: 'התקשר לגיא מלכה', why: 'מתקרר', priority: 'high', leadId: 101 }],
  moreCount: 3,
  ...over,
})

describe('toConversationState — PR1', () => {
  it('derives state from a reasoned recommendation', () => {
    const s = toConversationState(reasoned() as never)!
    expect(s.surfacedRefIds).toEqual(['101'])
    expect(s.executiveDecision).toContain('גיא')
    expect(s.whys).toEqual(['מתקרר'])
  })

  it('returns null for allClear (nothing to continue)', () => {
    expect(toConversationState(reasoned({ allClear: true, actions: [] }) as never)).toBeNull()
  })

  it('returns null for non-reasoned answers (data / fallback)', () => {
    expect(toConversationState({ kind: 'data', intent: 'system.overview' } as never)).toBeNull()
    expect(toConversationState({ kind: 'fallback', mode: 'redirect', gap: null } as never)).toBeNull()
  })

  it('returns null for a missing answer', () => {
    expect(toConversationState(null)).toBeNull()
    expect(toConversationState(undefined)).toBeNull()
  })
})
