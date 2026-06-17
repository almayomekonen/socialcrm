import { describe, it, expect } from 'vitest'
import { unansweredMessage } from '@/lib/copilot/general/unansweredMessage'

describe('unansweredMessage — explicit non-answer, never the bare chips', () => {
  it('unknown question → plainly says it has no answer', () => {
    expect(unansweredMessage('unknown')).toBe('אין לי תשובה לשאלה הזו.')
  })
  it('low-confidence question → says it did not understand', () => {
    expect(unansweredMessage('low-confidence')).toBe('לא בטוח שהבנתי את השאלה.')
  })
  it('never returns empty (an answer line is always shown above the suggestions)', () => {
    expect(unansweredMessage('unknown').length).toBeGreaterThan(0)
    expect(unansweredMessage('low-confidence').length).toBeGreaterThan(0)
  })
})
