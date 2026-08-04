import type { TemplateDefinition } from './types'

/**
 * The seeded marketplace.
 *
 * Content rules, inherited from the recipe catalog and enforced by test:
 * professional Hebrew, no emoji, runtime variables only from the closed set
 * (`{{שם הליד}}`, `{{שם העסק}}`, `{{שם הנציג}}`), and every template
 * expressible as one sentence.
 *
 * Every event key, action key, condition field and timing below is validated
 * against the live catalog in CI — a template naming something unregistered
 * fails the build, not a customer's install.
 */

const BUSINESS_SIGNOFF = 'בברכה,\n{{שם העסק}}'

export const TEMPLATE_ENTRIES: readonly TemplateDefinition[] = [
  // ── Lead ────────────────────────────────────────────────────────────────
  {
    key: 'website_lead_follow_up',
    version: 1,
    title: 'מעקב אחרי ליד מהאתר',
    category: 'lead',
    description: 'ליד שהגיע מהאתר מקבל מייל מעקב יום אחרי הפנייה, כדי שלא ייפול בין הכיסאות.',
    icon: 'envelope',
    requirements: [
      {
        type: 'connection',
        key: 'website_connected',
        cta: { label: 'חיבור האתר', href: '/settings/connections' },
      },
    ],
    variables: [
      {
        key: 'delayDays',
        type: 'enum_static',
        label: 'מתי לשלוח',
        options: [
          { value: '1', label: 'יום אחרי הפנייה' },
          { value: '2', label: 'יומיים אחרי הפנייה' },
        ],
        validation: { required: true },
        default: '1',
      },
    ],
    automations: [
      {
        name: 'מעקב אחרי ליד מהאתר',
        eventKey: 'form.submitted',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'custom', value: 1, unit: 'days' },
        parameters: {
          subject: 'עדיין כאן בשבילך',
          body: `שלום {{שם הליד}},

רצינו לוודא שהפנייה שלך מהאתר הגיעה אלינו והיא בטיפול.

אם נוח לך להוסיף פרטים או לתאם שיחה, אפשר פשוט להשיב למייל הזה.

${BUSINESS_SIGNOFF}`,
        },
      },
    ],
  },

  {
    key: 'welcome_sequence',
    version: 1,
    title: 'רצף קבלת פנים לליד חדש',
    category: 'lead',
    description: 'שלושה מיילים לאורך השבוע הראשון: אישור מיידי, הכירו אותנו אחרי יומיים, ותזכורת אחרי שבוע.',
    icon: 'envelope-open-text',
    requirements: [],
    variables: [],
    automations: [
      {
        name: 'קבלת פנים — אישור מיידי',
        eventKey: 'lead.created',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'preset', preset: 'immediate' },
        parameters: {
          subject: 'קיבלנו את הפנייה שלך',
          body: `שלום {{שם הליד}},

תודה שפנית אלינו. הפנייה שלך התקבלה והיא כבר אצלנו.

נחזור אליך בהקדם. אם יש משהו דחוף, אפשר להשיב למייל הזה.

${BUSINESS_SIGNOFF}`,
        },
      },
      {
        name: 'קבלת פנים — הכירו אותנו',
        eventKey: 'lead.created',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'custom', value: 2, unit: 'days' },
        parameters: {
          subject: 'קצת עלינו',
          body: `שלום {{שם הליד}},

רצינו לספר בקצרה איך אנחנו עובדים, כדי שיהיה לך ברור למה לצפות.

{{שם הנציג}} מלווה אותך מכאן והלאה, וכל שאלה אפשר לשלוח בתשובה למייל הזה.

${BUSINESS_SIGNOFF}`,
        },
      },
      {
        name: 'קבלת פנים — תזכורת אחרי שבוע',
        eventKey: 'lead.created',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'custom', value: 7, unit: 'days' },
        parameters: {
          subject: 'עדיין רלוונטי?',
          body: `שלום {{שם הליד}},

עבר שבוע מאז שפנית אלינו, ורצינו לבדוק אם זה עדיין רלוונטי עבורך.

אם כן — נשמח לתאם שיחה קצרה. אם לא, גם זה בסדר גמור; אפשר פשוט להשיב ונדע.

${BUSINESS_SIGNOFF}`,
        },
      },
    ],
  },

  {
    key: 'lost_lead_follow_up',
    version: 1,
    title: 'מעקב אחרי ליד שאבד',
    category: 'lead',
    description: 'ליד שסומן כאבוד מקבל מייל אחד, מכובד ולא נדחק, שמשאיר את הדלת פתוחה.',
    icon: 'rotate-left',
    requirements: [],
    variables: [],
    automations: [
      {
        name: 'מעקב אחרי ליד שאבד',
        eventKey: 'lead.status_changed',
        conditions: [{ field: 'status', operator: 'is', value: 'lost' }],
        actionKey: 'email.send',
        timing: { kind: 'custom', value: 14, unit: 'days' },
        parameters: {
          subject: 'הדלת נשארת פתוחה',
          body: `שלום {{שם הליד}},

לא התקדמנו הפעם, וזה לגמרי בסדר.

אם בעתיד זה יחזור להיות רלוונטי — אנחנו כאן, ואפשר פשוט להשיב למייל הזה.

${BUSINESS_SIGNOFF}`,
        },
      },
    ],
  },

  // ── Form ────────────────────────────────────────────────────────────────
  {
    key: 'contact_form_thank_you',
    version: 1,
    title: 'תודה על פנייה מהטופס',
    category: 'form',
    description: 'מי שממלא טופס באתר מקבל אישור מיידי שהפנייה הגיעה — לפני שהוא מספיק לתהות.',
    icon: 'file-lines',
    requirements: [
      {
        type: 'connection',
        key: 'website_connected',
        cta: { label: 'חיבור האתר', href: '/settings/connections' },
      },
    ],
    variables: [],
    automations: [
      {
        name: 'תודה על פנייה מהטופס',
        eventKey: 'form.submitted',
        conditions: [],
        actionKey: 'email.send',
        timing: { kind: 'preset', preset: 'immediate' },
        parameters: {
          subject: 'קיבלנו את הפנייה שלך',
          body: `שלום {{שם הליד}},

תודה שפנית אלינו דרך האתר. הפנייה שלך התקבלה ואנחנו כבר עליה.

נחזור אליך בהקדם.

${BUSINESS_SIGNOFF}`,
        },
      },
    ],
  },

  // ── Appointment ─────────────────────────────────────────────────────────
  {
    key: 'appointment_reminder',
    version: 1,
    title: 'תזכורת לפני פגישה',
    category: 'appointment',
    description: 'הליד מקבל תזכורת לפני הפגישה, עם המועד והפרטים — כדי שלא יישכח ולא יתבלבל.',
    icon: 'bell',
    /**
     * No requirement. The meeting already lives in the CRM, so there is nothing
     * to connect: this template works for every agency the moment it installs.
     */
    requirements: [],
    variables: [
      {
        key: 'remindBefore',
        type: 'enum_static',
        label: 'מתי לשלוח את התזכורת',
        options: [
          { value: '1h', label: 'שעה לפני הפגישה' },
          { value: '1d', label: 'יום לפני הפגישה' },
        ],
        validation: { required: true },
        default: '1d',
      },
    ],
    automations: [
      {
        name: 'תזכורת לפני פגישה',
        eventKey: 'appointment.booked',
        conditions: [],
        actionKey: 'email.send',
        /**
         * The customer's choice decides the offset; `timing` is the fallback if
         * the stored value is ever unusable. Counted back from `startsAt`, the
         * meeting's own start — which is what makes this a reminder rather than
         * a delay after booking.
         *
         * The three send-time checks (meeting exists, not cancelled, still in
         * the future) are ENGINE invariants, not conditions here, precisely so
         * they cannot be edited away.
         */
        timingFromVariable: { variableKey: 'remindBefore', anchorField: 'startsAt' },
        timing: { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'days' },
        parameters: {
          subject: 'תזכורת: {{שם הפגישה}}',
          body: `שלום {{שם הליד}},

תזכורת לפגישה שלנו:

{{פרטי הפגישה}}

אם משהו משתנה, אפשר להשיב למייל הזה ונתאם מחדש.

${BUSINESS_SIGNOFF}`,
        },
      },
    ],
  },

  // ── Internal ────────────────────────────────────────────────────────────
  {
    key: 'internal_task_on_new_lead',
    version: 1,
    title: 'משימה לנציג על כל ליד חדש',
    category: 'internal',
    description: 'כל ליד חדש פותח משימה לנציג המטפל, כך שאף פנייה לא נשארת בלי בעלים.',
    icon: 'user-plus',
    requirements: [],
    variables: [
      {
        key: 'taskTitle',
        type: 'text',
        label: 'כותרת המשימה',
        help: 'אפשר להשתמש ב-{{שם הליד}}',
        validation: { required: true, maxLength: 120 },
        default: 'ליד חדש — ליצור קשר עם {{שם הליד}}',
      },
    ],
    automations: [
      {
        name: 'משימה על ליד חדש',
        eventKey: 'lead.created',
        conditions: [],
        actionKey: 'task.create',
        timing: { kind: 'preset', preset: 'immediate' },
        parameters: { title: '[[taskTitle]]' },
      },
    ],
  },
] as const
