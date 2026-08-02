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
]
