import type { Timing } from '@/lib/automations/timing'

/**
 * The sheet's closed option tables and its machine-code → Hebrew map.
 * Split out of AutomationSheet so the sheet file holds behavior only
 * (architecture-rules: one responsibility per file, 250-line soft limit).
 */

export const TRIGGERS = [
  { id: 'lead_created', name: 'כשליד חדש נכנס' },
  { id: 'status_changed', name: 'כשסטטוס הליד משתנה' },
]

export const SOURCES = [
  { id: '', name: 'מכל מקור' },
  { id: 'facebook', name: 'מפייסבוק' },
  { id: 'whatsapp', name: 'מוואטסאפ' },
]

export const STATUSES = [
  { id: 'contacted', name: 'בטיפול' },
  { id: 'interested', name: 'מעוניין' },
  { id: 'closed', name: 'סגור' },
  { id: 'lost', name: 'אבוד' },
]

export const TIMINGS: Array<{ key: string; lbl: string; timing: Timing }> = [
  { key: 'immediate', lbl: 'מיד', timing: { kind: 'preset', preset: 'immediate' } },
  { key: 'one_hour', lbl: 'אחרי שעה', timing: { kind: 'preset', preset: 'one_hour' } },
  { key: 'one_day', lbl: 'אחרי יום', timing: { kind: 'preset', preset: 'one_day' } },
  { key: 'three_days', lbl: 'אחרי 3 ימים', timing: { kind: 'custom', value: 3, unit: 'days' } },
]

export const timingKey = (t: Timing) =>
  t.kind === 'preset' ? t.preset : t.value === 3 && t.unit === 'days' ? 'three_days' : 'one_day'

/** Actions return machine codes; the client owns the Hebrew (house convention). */
const ERRORS: Record<string, string> = {
  name_required: 'יש להזין שם לאוטומציה',
  subject_required: 'יש להזין נושא לאימייל',
  body_required: 'יש להזין תוכן לאימייל',
  status_required: 'יש לבחור סטטוס',
  timing_invalid: 'העיתוי אינו תקין',
  unknown_variable: 'יש בתוכן משתנה שאינו נתמך',
  forbidden: 'אין לך הרשאה לבצע פעולה זו',
  not_available: 'האוטומציות אינן זמינות בחשבון הזה',
  not_found: 'האוטומציה לא נמצאה',
  no_recipient: 'לא נמצאה כתובת אימייל לשליחת הבדיקה',
  content_required: 'יש להזין נושא ותוכן לפני שליחת בדיקה',
  no_sending_domain: 'שליחת אימיילים אינה מוגדרת עדיין. נדרשת בדיקה בהגדרות החשבון.',
  no_reply_to: 'חסרה כתובת אימייל לתשובות. יש להשלים אותה בהגדרות העסק.',
  send_failed: 'שליחת הבדיקה נכשלה. נסו שוב.',
}

export const errorMessage = (reason: string) => ERRORS[reason] ?? 'לא ניתן לשמור'
