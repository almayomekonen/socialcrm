import type { ActionDefinition } from '../types'

/**
 * Action catalog entries for the SHIPPED engine (frozen spec §8, phase B1).
 *
 * One action: `email.send`. Its `laws` list is the declaration of what
 * `decideSend` enforces today, in the order it enforces it — pinned by
 * conformance test. B2 makes the engine COMPOSE its pipeline from this
 * declaration instead of hardcoding it; B1 only declares it.
 */
export const ACTION_ENTRIES: readonly ActionDefinition[] = [
  {
    key: 'email.send',
    title: 'שליחת אימייל',
    description: 'שולח אימייל לליד בשם העסק',
    icon: 'envelope',
    requirements: [],
    // The engine's `no_email` skip is exactly this requirement enforced at
    // execution: an event with no email field could never satisfy it.
    requires: ['email'],
    parameters: [
      {
        key: 'subject',
        type: 'text',
        label: 'נושא האימייל',
        validation: { required: true, maxLength: 120 },
      },
      {
        key: 'body',
        type: 'text',
        label: 'תוכן האימייל',
        validation: { required: true },
      },
      /**
       * The optional CTA action block. ONE block in product terms — the Builder
       * adds and removes the pair together, and the renderer draws a button only
       * when both halves are present. Neither is required on its own.
       *
       * `text` + a serialised `pattern` rather than a new `url` parameter type:
       * validation is data (§3.7), and no integration may introduce a type
       * (Law 4). https only — an email button is not a place to downgrade.
       */
      {
        key: 'ctaLabel',
        type: 'text',
        label: 'טקסט הכפתור',
        help: 'למשל: לקביעת שיחה',
        validation: { maxLength: 40 },
      },
      {
        key: 'ctaUrl',
        type: 'text',
        label: 'קישור הכפתור',
        validation: { pattern: '^https://[^\\s]+$' },
      },
    ],
    /**
     * Exactly the laws decideSend applies to an email send today:
     *   suppressed → suppression        · no_email → (requires: email)
     *   address_undeliverable → bounce_block
     *   already_sent → send_once        · lead_daily_cap → per_lead_cap
     *   agency_daily_cap → agency_cap   · quiet_hours → quiet_hours
     *
     * origin_import / lead_deleted / premise_expired are engine-universal
     * guards, not per-action laws, so they are deliberately absent.
     */
    laws: ['send_once', 'per_lead_cap', 'agency_cap', 'suppression', 'bounce_block', 'quiet_hours'],
    risk: 'external',
    preview: 'email',
    testable: true,
  },
  {
    key: 'task.create',
    title: 'יצירת משימה לנציג',
    description: 'פותח משימה לנציג שמטפל בליד',
    icon: 'list-check',
    requirements: [],
    // Delivers to nobody, so it is offered for every event — including ones
    // whose subject has no email at all.
    requires: [],
    parameters: [
      {
        key: 'title',
        type: 'text',
        label: 'כותרת המשימה',
        validation: { required: true, maxLength: 120 },
      },
    ],
    /**
     * The frozen §3.8 correctness case: `send_once` and NOTHING else.
     *
     * A suppressed lead must still get a task — suppression is consent not to
     * be contacted, which says nothing about the rep's own worklist. Caps and
     * quiet hours are equally wrong here: they exist to protect the LEAD's
     * inbox, and a task never reaches it.
     */
    laws: ['send_once'],
    risk: 'internal',
    preview: 'record',
    testable: false,
  },
]
