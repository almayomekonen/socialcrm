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
  {
    key: 'whatsapp.send',
    title: 'שליחת הודעת וואטסאפ',
    description: 'שולח לליד הודעה מוכנה שאושרה בוואטסאפ',
    icon: 'whatsapp',
    /**
     * Gated on the EXISTING WhatsApp Business connection — not a new one. The
     * capability is already granted by `whatsappProvider`, so a business that
     * connected WhatsApp for the inbox has already done everything this needs.
     */
    requirements: [
      {
        type: 'connection',
        key: 'whatsapp_connected',
        cta: { label: 'חיבור וואטסאפ', href: '/settings/integrations?section=whatsapp' },
      },
    ],
    /**
     * The messaging counterpart to email's `requires: ['email']`. Resolves to the
     * event's declared `phone` field; an event without one can never offer this
     * action, which is exactly right.
     */
    requires: ['phone'],
    parameters: [
      {
        key: 'templateId',
        /**
         * The SAME generic remote picker the form selector uses. Options come
         * from the connector's `options()`, so the Builder renders a template
         * list without learning what a template is.
         */
        type: 'enum_remote',
        label: 'ההודעה המוכנה',
        help: 'רק הודעות שאושרו בוואטסאפ אפשר לשלוח באוטומציה',
        optionSource: 'whatsapp_templates',
        validation: { required: true },
      },
      {
        /**
         * Slot mapping, as data: `{"1":"leadFirstName"}`. Stored on the action's
         * parameters like every other parameter — no schema change, and no new
         * parameter TYPE (Law 4): it is authored by a dedicated control and read
         * back as text, the same trade `ctaUrl`'s serialised pattern makes.
         *
         * Empty for every template authored in SocialCRM, whose chips already
         * carry their own meaning. Only Meta-synced templates need it.
         */
        key: 'templateBindings',
        type: 'text',
        label: 'שיוך הפרטים בהודעה',
      },
    ],
    /**
     * Every law that protects the LEAD, and no more.
     *
     * `opt_out` rather than `suppression`: email unsubscribe and a WhatsApp
     * "עצור" are different consents, and honouring the wrong one would either
     * ignore a request to stop or silence a lead who only left the mailing list.
     *
     * NOT `window_24h` — this action is template-only, and an approved template
     * delivers whether the 24-hour window is open or closed. NOT `bounce_block`
     * — no phone block list exists, and `recipientBlocks` treats an unregistered
     * kind as unblocked rather than inventing a block.
     */
    laws: ['send_once', 'per_lead_cap', 'agency_cap', 'opt_out', 'quiet_hours'],
    risk: 'external',
    preview: 'message',
    /**
     * No test send. A WhatsApp test costs real money per message and spends the
     * template's quality rating, and there is no inert recipient the way email
     * has lead 0. The preview runs the real resolver, so it already shows
     * everything a test would.
     */
    testable: false,
  },
  {
    key: 'quote.create',
    title: 'הכנת הצעת מחיר לנציג',
    description: 'בונה טיוטת הצעת מחיר לליד מתוך תבנית, ומשאירה אותה לנציג',
    icon: 'file-invoice',
    requirements: [],
    /**
     * Delivers to NOBODY, so it is offered for every event — including ones
     * whose subject has no email at all. The rep opens the draft; nothing
     * reaches the customer, which is the difference between this action and the
     * sending one that will follow it.
     */
    requires: [],
    parameters: [
      {
        /**
         * The agency's OWN price list — `enum_agency`, not `enum_remote`.
         * Quote templates sit behind no connection and no capability, so the
         * connector-backed door would answer `[]` forever; and the distinct type
         * is what keeps a first-party answer structurally out of `sourceIds`.
         */
        key: 'quoteTemplateId',
        type: 'enum_agency',
        label: 'תבנית הצעת המחיר',
        help: 'המחירים נלקחים מהתבנית, ונשמרים על ההצעה כפי שהם באותו רגע',
        optionSource: 'quote_templates',
        validation: { required: true },
      },
    ],
    /**
     * `send_once` and NOTHING else — the same law set as `task.create`, for the
     * same reason. A SUPPRESSED lead must still get a quote drafted: suppression
     * is consent not to be CONTACTED, and this action contacts nobody. Caps and
     * quiet hours protect the lead's inbox, which a draft never reaches.
     *
     * The sending counterpart, when it arrives, declares the full external set.
     * That difference is precisely why it will be a separate action key.
     */
    laws: ['send_once'],
    risk: 'internal',
    preview: 'record',
    /**
     * No test send. There is no inert recipient for a quote — a test would
     * create a real row on a real lead, which is not a test.
     */
    testable: false,
  },
]
