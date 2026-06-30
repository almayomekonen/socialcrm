import { describe, it, expect } from 'vitest'
import { classifyConversationIntent } from '@/lib/copilot/general/conversationIntent'

describe('classifyConversationIntent — PR1 (follow-up only)', () => {
  it('detects bare follow-up utterances', () => {
    for (const t of ['anything else?', 'What else?', 'continue', 'Continue.', 'go on', 'keep going', 'more', 'עוד משהו', 'מה עוד', 'תמשיך', 'המשך', 'עוד']) {
      expect(classifyConversationIntent(t)).toBe('follow_up')
    }
  })

  it('does NOT hijack real business questions that merely contain a word', () => {
    for (const t of [
      'מה הכי דחוף היום?',
      'why are leads going cold?',
      'what about Dana?',
      'anything else for today?',
      'continue the deal with Dana',
      'מה לעשות עכשיו?',
    ]) {
      expect(classifyConversationIntent(t)).toBe('none')
    }
  })

  it('is case- and punctuation-insensitive for the bare phrases', () => {
    expect(classifyConversationIntent('  Anything Else???  ')).toBe('follow_up')
  })
})
