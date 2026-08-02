import type { Timing } from '@/lib/automations/timing'

/**
 * The sheet's remaining local constants — timing presets and error copy.
 *
 * B3 REMOVED the trigger list, the lead-source list and the status list from
 * this file. All three are now read from the catalog: events from
 * listSelectableEvents(), and condition fields/operators/values from the
 * selected event's declared `fields`. Nothing here names an integration, a
 * status, or a trigger.
 */

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
  trigger_invalid: 'האירוע שנבחר אינו זמין',
  condition_field_unknown: 'אחד התנאים מפנה לשדה שאינו קיים',
  condition_operator_invalid: 'אחד התנאים משתמש בהשוואה שאינה נתמכת',
  condition_value_required: 'יש להשלים ערך בתנאי',
  condition_value_invalid: 'ערך התנאי אינו אחת האפשרויות',
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
