import type { Timing } from './timing'
import type { Condition } from './conditions'

/**
 * The V1 recipe catalog (spec §7) — static starter content, not UI. Users
 * adopt a recipe and edit the copy; nothing here sends anything. FOUR
 * starters: the pre-event reminder ("תזכורת לפני האירוע") is deliberately
 * held back with the event-date anchor (ADR-007).
 *
 * Content rules: professional Hebrew, no emoji, variables only from the
 * closed set in ./variables.ts, every recipe expressible as one sentence
 * (trigger → email → timing). recipes.test.ts guards all of this.
 */

export type AutomationRecipe = {
  key: string // stable id; referenced by adopted automations (append-only)
  name: string // outcome-named, Hebrew — the card title
  description: string // one line under the title
  /** A catalog event key. The recipe names no trigger vocabulary of its own. */
  eventKey: string
  /** Preset conditions, expressed against that event's declared fields. */
  conditions: readonly Condition[]
  timing: Timing
  subject: string
  body: string // plain paragraphs, blank-line separated; rendered in Phase 4
}

export const AUTOMATION_RECIPES: readonly AutomationRecipe[] = [
  {
    key: 'welcome_new_lead',
    name: 'אימייל פתיחה לליד חדש',
    description: 'כשליד חדש נכנס — הוא מקבל אישור מיידי שהפנייה התקבלה.',
    eventKey: 'lead.created',
    conditions: [],
    timing: { kind: 'preset', preset: 'immediate' },
    subject: 'קיבלנו את הפנייה שלך',
    body: `שלום {{שם הליד}},

תודה שפנית אלינו — הפנייה שלך התקבלה, ונחזור אליך בהקדם.

אם נוח לך להוסיף פרטים שיעזרו לנו להתכונן, אפשר פשוט להשיב למייל הזה.

בברכה,
{{שם העסק}}`,
  },
  {
    key: 'webinar_registration_confirmation',
    name: 'אישור הרשמה לוובינר',
    description: 'כשליד נרשם דרך טופס — הוא מקבל אישור הרשמה מסודר.',
    eventKey: 'lead.created',
    conditions: [{ field: 'source', operator: 'contains', value: 'facebook' }],
    timing: { kind: 'preset', preset: 'immediate' },
    subject: 'ההרשמה שלך אושרה',
    body: `שלום {{שם הליד}},

ההרשמה שלך התקבלה ומקומך שמור.

פרטי ההשתתפות המלאים יישלחו אליך בהמשך. אם יש שאלה בינתיים — אפשר להשיב למייל הזה ונשמח לעזור.

נתראה,
{{שם העסק}}`,
  },
  {
    key: 'deal_closed_thank_you',
    name: 'תודה על סגירת העסקה',
    description: 'כשליד נסגר — הוא מקבל אימייל תודה אישי.',
    eventKey: 'lead.status_changed',
    conditions: [{ field: 'newStatus', operator: 'is', value: 'closed' }],
    timing: { kind: 'preset', preset: 'immediate' },
    subject: 'תודה שבחרת בנו',
    body: `שלום {{שם הליד}},

תודה על האמון. אנחנו שמחים שבחרת בנו.

אם תצטרך משהו בהמשך, או שתתעורר שאלה, אפשר פשוט להשיב למייל הזה ונשמח לעזור.

בברכה,
{{שם העסק}}`,
  },
  {
    key: 'in_progress_follow_up',
    name: 'אימייל מעקב לליד בטיפול',
    description: 'כשליד עובר לטיפול — הוא מקבל עדכון שמרגיעים אותו שלא נשכח.',
    eventKey: 'lead.status_changed',
    conditions: [{ field: 'newStatus', operator: 'is', value: 'contacted' }],
    timing: { kind: 'preset', preset: 'one_day' },
    subject: 'אנחנו על זה',
    body: `שלום {{שם הליד}},

רק רצינו לעדכן שהפנייה שלך נמצאת אצלנו ולא נשכחה.

אם יש משהו נוסף שכדאי שנדע, או שאלה בינתיים, אפשר להשיב למייל הזה בכל שלב.

בברכה,
{{שם העסק}}`,
  },
] as const
