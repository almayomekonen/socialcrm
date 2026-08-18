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
    expect(quickClassifyGeneral('מה הכי דחוף במערכת?').intent).toBe('crm.attention')
    expect(quickClassifyGeneral('מי הליד הכי דחוף?').intent).toBe('crm.attention')
    expect(quickClassifyGeneral('מי שלח הודעות וואטסאפ לאחרונה?').intent).toBe('inbox.recentInbound')
    expect(quickClassifyGeneral('מי שלח לי הודעה לאחרונה?').intent).toBe('inbox.recentInbound')
    expect(quickClassifyGeneral('מי כתב לי בוואטסאפ?').intent).toBe('inbox.recentInbound')
    expect(quickClassifyGeneral('מי מחכה לי בוואטסאפ?').intent).toBe('inbox.waiting')
    expect(quickClassifyGeneral('למי צריך לענות?').intent).toBe('inbox.waiting')
    expect(quickClassifyGeneral('יש הודעות שלא קראתי?').intent).toBe('inbox.unread')
    expect(quickClassifyGeneral('מי לא נקרא?').intent).toBe('inbox.unread')
    expect(quickClassifyGeneral('מה חדש במערכת?').intent).toBe('system.overview')
    expect(quickClassifyGeneral('מה מצב הפגישות?').intent).toBe('meetings.today')
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
