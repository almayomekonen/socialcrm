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

/**
 * A STABLE key per timing, including timings this list does not offer.
 *
 * The old form fell through to `'one_day'` for anything that was not a preset or
 * exactly three days. That was harmless while every timing was a delay — and
 * destructive once before-anchor timing existed: an installed "an hour before the
 * meeting" reminder would render with "אחרי יום" selected, and saving the sheet
 * would write that preset over it, silently converting a reminder into a delay
 * after booking.
 */
export const timingKey = (t: Timing): string => {
  if (t.kind === 'preset') return t.preset
  if (t.kind === 'before_anchor') return `before:${t.anchorField}:${t.value}${t.unit === 'hours' ? 'h' : 'd'}`
  if (t.value === 3 && t.unit === 'days') return 'three_days'
  return `after:${t.value}${t.unit === 'hours' ? 'h' : 'd'}`
}

/** Hebrew label for a timing the preset list does not contain. */
const OFFSET_LABEL = (value: number, unit: 'hours' | 'days'): string =>
  unit === 'hours' ? (value === 1 ? 'שעה' : `${value} שעות`) : value === 1 ? 'יום' : `${value} ימים`

/**
 * The options to render for a given saved timing: the presets, plus the saved
 * timing itself when it is not one of them.
 *
 * This is what makes the sheet round-trip a timing it cannot author. The
 * customer sees what the automation actually does, the option is selected, and
 * saving preserves it — instead of the sheet quietly replacing it with the
 * nearest preset.
 */
export function timingOptionsFor(current: Timing): Array<{ key: string; lbl: string; timing: Timing }> {
  const key = timingKey(current)
  if (TIMINGS.some((t) => t.key === key)) return TIMINGS
  const label =
    current.kind === 'before_anchor'
      ? `${OFFSET_LABEL(current.value, current.unit)} לפני המועד`
      : current.kind === 'custom'
        ? `אחרי ${OFFSET_LABEL(current.value, current.unit)}`
        : key
  return [...TIMINGS, { key, lbl: label, timing: current }]
}

/** Actions return machine codes; the client owns the Hebrew (house convention). */
const ERRORS: Record<string, string> = {
  name_required: 'יש להזין שם לאוטומציה',
  subject_required: 'יש להזין נושא לאימייל',
  body_required: 'יש להזין תוכן לאימייל',
  trigger_invalid: 'האירוע שנבחר אינו זמין',
  action_invalid: 'לא נמצאה פעולה שניתן להפעיל עבור האירוע שנבחר',
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
  cta_incomplete: 'לכפתור צריך גם טקסט וגם קישור, או להסיר אותו',
  cta_label_invalid: 'טקסט הכפתור ארוך מדי',
  cta_url_invalid: 'קישור הכפתור חייב להתחיל ב-https://',
  preview_failed: 'לא ניתן להציג תצוגה מקדימה כרגע. נסו שוב.',
}

export const errorMessage = (reason: string) => ERRORS[reason] ?? 'לא ניתן לשמור'
