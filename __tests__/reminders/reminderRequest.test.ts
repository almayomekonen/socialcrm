/** Reminder Engine Phase 6: the owner's request, read from their own words (pure). */
import { describe, expect, it } from 'vitest'
import { isReminderCorrection, mergeWhen, reminderIntent, reminderText, targetPhrase, targetTime } from '@/lib/reminders/request'

describe('reminderIntent', () => {
  it.each([
    ['בעוד 5 דקות תזכיר לי להתקשר לאבי', 'create'],
    ['תזכירי לי מחר בתשע לבדוק את ההצעה', 'create'],
    ['תזכורת להתקשר לרון בעוד שעה', 'create'],
    ['תקבע לי תזכורת ב-17:00 לצאת', 'create'],
    ['אילו תזכורות יש לי?', 'list'],
    ['מה התזכורות שלי', 'list'],
    ['תזכורות', 'list'],
    ['תבטל את התזכורת להתקשר לאבי', 'cancel'],
    ['לבטל תזכורת של 14:35', 'cancel'],
    ['תזיז את התזכורת להתקשר לאבי ל-16:00', 'reschedule'],
    ['תדחה את התזכורת בעוד חצי שעה', 'reschedule'],
    // Production 2026-11-07 (agency 103): "תזכיר" WITHOUT "לי", followed by an action.
    ['תזכיר להתקשר ל-לייה חדש בעוד 3 דקות', 'create'],
    ['תזכיר להתקשר ללייה בעוד 3 דקות', 'create'],
    ['תזכירי לבדוק את ההצעה בעוד שעה', 'create'],
    ['בעוד 10 דקות תזכיר לחזור לרון', 'create'],
  ])('%s → %s', (text, intent) => {
    expect(reminderIntent(text)).toBe(intent)
  })

  it.each([
    'תיצור משימה להתקשר לדני',
    'תזכיר לי לקבוע מעקב לדני מחר',
    'כמה לידים חדשים יש היום?',
    'תקבע פגישה עם אבי מחר ב-10',
    'להתקשר לאבי',
    'תזכיר לדני מחר את הפגישה', // "remind Danny": no "לי", no action verb → not ours
  ])('not a personal reminder: %s', (text) => {
    expect(reminderIntent(text)).toBeNull()
  })
})

describe('an explicit correction: "not a task, a reminder"', () => {
  it.each(['לא משימה! תזכורת', 'לא משימה, תזכורת', 'תזכורת, לא משימה', 'זה לא מעקב, זו תזכורת'])('%s', (text) => {
    expect(isReminderCorrection(text)).toBe(true)
  })
  it.each(['תיצור משימה', 'לא תזכורת, משימה', 'תזכורת', 'לא משימה'])('not a correction: %s', (text) => {
    expect(isReminderCorrection(text)).toBe(false)
  })
})

describe('reminderText', () => {
  it.each([
    ['בעוד 5 דקות תזכיר לי להתקשר לאבי', 'להתקשר לאבי'],
    ['תזכיר לי בעוד שעה לבדוק את ההצעה', 'לבדוק את ההצעה'],
    ['מחר בתשע תזכיר לי להתקשר לאבי', 'להתקשר לאבי'],
    ['תזכיר לי ב-17:30 לצאת לפגישה עם דנה.', 'לצאת לפגישה עם דנה'],
    ['תזכורת להתקשר לרון בעוד רבע שעה בבקשה', 'להתקשר לרון'],
    ['היום ב-9 בערב תזכירי לי לשלוח 3 הצעות', 'לשלוח 3 הצעות'],
    ['תזכיר לי בעוד 10 דקות', ''],
    ['תזכיר להתקשר ל-לייה חדש בעוד 3 דקות', 'להתקשר ל-לייה חדש'],
    ['תזכיר להתקשר ללייה בעוד 3 דקות', 'להתקשר ללייה'],
    ['לא משימה, תזכורת', ''],
    ['לא משימה! תזכורת להתקשר לרון בעוד 5 דקות', 'להתקשר לרון'],
  ])('%s → "%s"', (text, out) => {
    expect(reminderText(text)).toBe(out)
  })
})

describe('mergeWhen', () => {
  const today = '2026-11-07'
  it('a new time replaces the request’s time, its date stays', () => {
    expect(mergeWhen('מחר בשלוש תזכיר לי להתקשר לאבי', 'בשלוש אחה"צ', today)).toBe('מחר תזכיר לי להתקשר לאבי בשלוש אחה"צ')
  })
  it('a new date replaces the request’s date, its time stays', () => {
    expect(mergeWhen('היום בתשע תזכיר לי X', 'מחר', today)).toBe('בתשע תזכיר לי X מחר')
  })
  it('an offset replaces both', () => {
    expect(mergeWhen('מחר בתשע תזכיר לי X', 'בעוד 20 דקות', today)).toBe('תזכיר לי X בעוד 20 דקות')
  })
  it('a period alone keeps the hour it qualifies', () => {
    expect(mergeWhen('תזכיר לי בשש להתקשר', 'בערב', today)).toBe('תזכיר לי בשש להתקשר בערב')
  })
})

describe('which reminder', () => {
  it('the phrase without verb, "התזכורת" and times', () => {
    expect(targetPhrase('תבטל את התזכורת להתקשר לאבי')).toBe('להתקשר לאבי')
    expect(targetPhrase('תזיז את התזכורת להתקשר לאבי ל-16:00')).toBe('להתקשר לאבי')
    expect(targetPhrase('תבטל את התזכורת')).toBe('')
  })
  it('"של 14:35" names the reminder; the rest keeps the new time', () => {
    expect(targetTime('תזיז את התזכורת של 14:35 ל-16:00')).toEqual({ time: '14:35', rest: 'תזיז את התזכורת ל-16:00' })
    expect(targetTime('תזיז את התזכורת ל-16:00').time).toBeNull()
  })
})
