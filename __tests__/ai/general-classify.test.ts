import { describe, it, expect } from 'vitest'
import { quickClassifyGeneral } from '@/lib/copilot/general/classifyGeneralIntent'

// The quick pass is the closed-world guarantee: known utterances map to a known
// id; everything else is 'unknown' (→ capability menu, never a guess).
describe('quickClassifyGeneral — closed world', () => {
  it('maps briefing utterances to their intent', () => {
    expect(quickClassifyGeneral('מי צריך מעקב היום').intent).toBe('followups.dueToday')
    expect(quickClassifyGeneral('משימות באיחור').intent).toBe('tasks.overdue')
    expect(quickClassifyGeneral('פגישות היום').intent).toBe('meetings.today')
    expect(quickClassifyGeneral('סכם את התיבה').intent).toBe('inbox.unread')
    expect(quickClassifyGeneral('לידים חדשים השבוע').intent).toBe('leads.newThisWeek')
    expect(quickClassifyGeneral('מי לא דיברתי איתו מזמן').intent).toBe('leads.notContactedRecently')
    expect(quickClassifyGeneral('מה דחוף').intent).toBe('crm.attention')
  })

  it('maps guide utterances to their guide id', () => {
    expect(quickClassifyGeneral('איך מחברים וואטסאפ').intent).toBe('guide.connectWhatsapp')
    expect(quickClassifyGeneral('איך מעלים לידים').intent).toBe('guide.importLeads')
    expect(quickClassifyGeneral('קח אותי ליומן').intent).toBe('guide.calendar')
  })

  it('returns unknown for anything outside the closed set', () => {
    expect(quickClassifyGeneral('כמה עולה מניית טבע').intent).toBe('unknown')
    expect(quickClassifyGeneral('ספר לי בדיחה').intent).toBe('unknown')
    expect(quickClassifyGeneral('').intent).toBe('unknown')
  })
})
