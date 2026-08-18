import { describe, it, expect } from 'vitest'
import { classifyConversationIntent } from '@/lib/copilot/general/conversationIntent'

describe('classifyConversationIntent — follow-up / why / who-else / how / now', () => {
  it('detects bare follow-up utterances', () => {
    for (const t of [
      'anything else?',
      'What else?',
      'continue',
      'Continue.',
      'go on',
      'keep going',
      'more',
      'עוד משהו',
      'מה עוד',
      'תמשיך',
      'המשך',
      'עוד',
      'תן לי עוד',
      'תני לי עוד',
    ]) {
      expect(classifyConversationIntent(t)).toBe('follow_up')
    }
  })

  it('detects why / who-else / how / now', () => {
    expect(classifyConversationIntent('למה?')).toBe('why')
    expect(classifyConversationIntent('מדוע')).toBe('why')
    expect(classifyConversationIntent('מי עוד')).toBe('who_else')
    expect(classifyConversationIntent('ומי עוד?')).toBe('who_else')
    expect(classifyConversationIntent('איך?')).toBe('how')
    expect(classifyConversationIntent('איך ממשיכים')).toBe('how')
    expect(classifyConversationIntent('ומה עכשיו?')).toBe('now')
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
