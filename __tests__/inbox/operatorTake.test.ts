import { describe, it, expect } from 'vitest'
import { passesNonObvious, isObviousRestatement, isHoldout, selectRenderableTake } from '@/lib/inbox/intelligence/operatorTake'
import type { OperatorTakeRow } from '@/db/conversationIntelligence'

describe('passesNonObvious — §9.2 acceptance fixtures', () => {
  const mustFail = [
    { actionMessage: 'הליד ממתין לתשובה', noveltyKind: 'none' as const },
    { actionMessage: 'עברו שלושה ימים', noveltyKind: 'attention' as const }, // denylist catches mislabel
    { actionMessage: 'הכדור אצלך', noveltyKind: 'attention' as const },
    { actionMessage: '', noveltyKind: 'action' as const }, // empty message
  ]
  for (const f of mustFail) {
    it(`must_fail: "${f.actionMessage}" / ${f.noveltyKind}`, () => {
      expect(passesNonObvious(f)).toBe(false)
    })
  }

  const mayPass = [
    { actionMessage: 'אל תוריד עכשיו את המחיר', noveltyKind: 'action' as const },
    { actionMessage: 'הוא משווה אלטרנטיבות, לא מתמקח', noveltyKind: 'interpretation' as const },
    { actionMessage: 'תתמקד בהצעה, לא במחיר', noveltyKind: 'interpretation' as const },
  ]
  for (const f of mayPass) {
    it(`may_pass: "${f.actionMessage}" / ${f.noveltyKind}`, () => {
      expect(passesNonObvious(f)).toBe(true)
    })
  }
})

describe('isObviousRestatement', () => {
  it('flags waiting/days/ball phrasings', () => {
    expect(isObviousRestatement('הליד ממתין לתשובה')).toBe(true)
    expect(isObviousRestatement('עברו 3 ימים מאז')).toBe(true)
    expect(isObviousRestatement('הכדור אצלך עכשיו')).toBe(true)
  })
  it('does not flag a real recommendation', () => {
    expect(isObviousRestatement('אל תוריד עכשיו את המחיר')).toBe(false)
  })
})

describe('selectRenderableTake', () => {
  const base: OperatorTakeRow = {
    status: 'fresh',
    coveredSequence: 12,
    promptVersion: '4',
    data: {
      suggestedAction: 'follow_up',
      reason: 'הוא שאל על תשלומים ולא נענה',
      actionMessage: 'תחזור לשאלה על התשלומים',
      noveltyKind: 'attention',
      sourceMessageIds: [101, 104],
    },
  }
  it('returns a take when grounded + non-obvious', () => {
    const t = selectRenderableTake(42, base)
    expect(t?.takeId).toBe('42:12')
    expect(t?.sourceMessageIds).toEqual([101, 104])
  })
  it('drops ungrounded takes (Law 1)', () => {
    expect(selectRenderableTake(42, { ...base, data: { ...base.data, sourceMessageIds: [] } })).toBeNull()
  })
  it('drops obvious takes (noveltyKind none)', () => {
    expect(selectRenderableTake(42, { ...base, data: { ...base.data, noveltyKind: 'none' } })).toBeNull()
  })
  it('drops failed rows and suggestedAction=none', () => {
    expect(selectRenderableTake(42, { ...base, status: 'failed' })).toBeNull()
    expect(selectRenderableTake(42, { ...base, data: { ...base.data, suggestedAction: 'none' } })).toBeNull()
  })
  it('marks stale rows', () => {
    expect(selectRenderableTake(42, { ...base, status: 'stale' })?.stale).toBe(true)
  })
})

describe('isHoldout', () => {
  it('is deterministic per conversation', () => {
    expect(isHoldout(42)).toBe(isHoldout(42))
  })
  it('splits the space (some in, some out across a range)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1)
    const held = ids.filter(isHoldout).length
    expect(held).toBeGreaterThan(0)
    expect(held).toBeLessThan(100)
  })
})
