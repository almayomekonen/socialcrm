import type { EventDefinition, FieldDefinition } from '../types'

/**
 * Event catalog entries for the SHIPPED engine (frozen spec §8, phase B1).
 *
 * These describe behaviour that already runs in production. Nothing here adds
 * capability — B1's gate is "existing automations behave identically", so every
 * declaration below is a faithful description of what the engine does today,
 * pinned by __tests__/automations/catalogConformance.test.ts.
 *
 * Both events are `origin: 'internal'` — produced by our own domain writes
 * (actions/clients.ts, actions/leadOutcome.ts), not by a connector webhook and
 * not by a scheduled evaluator.
 */

/**
 * Fields the worker actually has at execution time. Freshness is not
 * decorative: the worker re-reads lead facts via getLeadFacts and resolves the
 * business/rep names at send time, so those are `live`; values captured on the
 * event itself are `snapshot`.
 */
/**
 * The lead pipeline's statuses, as catalog data. Declaring them here is what
 * removes the last hardcoded status list from Builder code: the condition
 * editor's value dropdown and the sentence's labels both read this.
 * Mirrors components/clients/LeadStatusCell.tsx, the product's canonical list.
 */
const LEAD_STATUS_OPTIONS = [
  { value: 'new', label: 'חדש' },
  { value: 'contacted', label: 'בטיפול' },
  { value: 'interested', label: 'מעוניין' },
  { value: 'closed', label: 'סגור' },
  { value: 'lost', label: 'אבוד' },
] as const

const LEAD_FIELDS: readonly FieldDefinition[] = [
  { key: 'leadFirstName', type: 'text', label: 'שם הליד', freshness: 'live', lifecycle: 'stable' },
  { key: 'businessName', type: 'text', label: 'שם העסק', freshness: 'live', lifecycle: 'stable' },
  { key: 'repName', type: 'text', label: 'שם הנציג', freshness: 'live', lifecycle: 'stable' },
  { key: 'email', type: 'email', label: 'אימייל הליד', freshness: 'live', lifecycle: 'stable' },
  {
    key: 'status',
    type: 'enum',
    label: 'סטטוס הליד',
    freshness: 'live',
    lifecycle: 'stable',
    options: LEAD_STATUS_OPTIONS,
  },
]

/**
 * The first three fields are exactly the closed variable set the renderer
 * exposes as chips (`AUTOMATION_EMAIL_VARIABLES`). Declaring them as fields is
 * what makes "add a field, get a variable" true in B3 — today it is pinned by
 * conformance test rather than derived, because deriving it at runtime would
 * erase the literal types the renderer depends on (see the B1 audit).
 */
export const RENDERABLE_FIELD_KEYS = ['leadFirstName', 'businessName', 'repName'] as const

/**
 * B7 — the first EXTERNAL event, and the proof that the Builder is generic.
 *
 * Everything the Builder will show for it, it learns from this entry: the
 * picker grouping (`subject`), the lock and its CTA (`requirements`), the
 * calendar picker (`parameters` → enum_remote), the condition fields and their
 * operators (`fields` → type), the timing anchor (the `datetime` field), the
 * offered actions (`requires` × field types) and the preview shape (the
 * action's). No Builder file changes for any of it.
 */
/**
 * The meeting's own LIVE state, re-read at send time.
 *
 * Live rather than snapshot for two different reasons, both load-bearing:
 *   · the reminder's guard needs the CURRENT status — a meeting cancelled after
 *     booking must not produce a reminder;
 *   · the email must show the CURRENT time and place, not what they were when
 *     the meeting was booked.
 *
 * `meetingWhen` and `meetingDetails` are RESOLVED STRINGS, formatted on the
 * server in the business timezone. A recipient's device timezone is not the
 * business's, and the meeting's moment is the business's fact.
 */
const MEETING_LIVE_FIELDS: readonly FieldDefinition[] = [
  {
    key: 'meetingStatus',
    type: 'enum',
    label: 'מצב הפגישה',
    freshness: 'live',
    lifecycle: 'stable',
    options: [
      { value: 'scheduled', label: 'מתוכננת' },
      { value: 'cancelled', label: 'בוטלה' },
      { value: 'completed', label: 'התקיימה' },
      { value: 'no_show', label: 'לא הגיע' },
    ],
  },
  { key: 'meetingTitle', type: 'text', label: 'שם הפגישה', freshness: 'live', lifecycle: 'stable' },
  { key: 'meetingWhen', type: 'text', label: 'מועד הפגישה', freshness: 'live', lifecycle: 'stable' },
  { key: 'meetingDetails', type: 'text', label: 'פרטי הפגישה', freshness: 'live', lifecycle: 'stable' },
]

const APPOINTMENT_FIELDS: readonly FieldDefinition[] = [
  ...LEAD_FIELDS,
  ...MEETING_LIVE_FIELDS,
  {
    key: 'startsAt',
    type: 'datetime',
    label: 'מועד הפגישה',
    freshness: 'snapshot',
    lifecycle: 'stable',
  },
  {
    key: 'appointmentName',
    type: 'text',
    label: 'סוג הפגישה',
    freshness: 'snapshot',
    lifecycle: 'stable',
  },
  {
    key: 'inviteeEmail',
    type: 'email',
    label: 'אימייל מזמין הפגישה',
    freshness: 'snapshot',
    lifecycle: 'stable',
  },
]

/**
 * C1 — the first PRODUCTION integration's event. Catalog data only: no new
 * field type, no new parameter type, no new preview shape, no new law.
 *
 * `formName` and `pageUrl` are snapshots because a form can be renamed or a
 * page moved after the fact, and an automation that fired on "צור קשר" should
 * keep meaning that. `message` is a snapshot for the same reason — it is what
 * the person actually wrote.
 */
const FORM_FIELDS: readonly FieldDefinition[] = [
  ...LEAD_FIELDS,
  { key: 'formName', type: 'text', label: 'שם הטופס', freshness: 'snapshot', lifecycle: 'stable' },
  { key: 'message', type: 'text', label: 'תוכן ההודעה', freshness: 'snapshot', lifecycle: 'stable' },
  { key: 'pageUrl', type: 'url', label: 'העמוד שממנו נשלח', freshness: 'snapshot', lifecycle: 'stable' },
]

export const EVENT_ENTRIES: readonly EventDefinition[] = [
  {
    key: 'lead.created',
    origin: 'internal',
    subject: 'lead',
    title: 'ליד חדש נכנס',
    description: 'כשליד חדש נוצר במערכת — מפייסבוק, מוואטסאפ או בהוספה ידנית',
    icon: 'user-plus',
    lifecycle: 'stable',
    requirements: [],
    parameters: [],
    fields: [
      ...LEAD_FIELDS,
      // Captured at emission from the lead row. Snapshot freshness is why a
      // condition on it is decided at emission: the value cannot change
      // afterwards, so evaluating it later would give the same answer.
      { key: 'source', type: 'text', label: 'מקור הליד', freshness: 'snapshot', lifecycle: 'stable' },
    ],
    identity: {
      occurrenceKey: 'lead_created',
      leadResolution: 'the lead row just inserted — resolved by the creating call site before emission (ADR-004 origin)',
    },
  },
  {
    key: 'lead.status_changed',
    origin: 'internal',
    subject: 'lead',
    title: 'סטטוס הליד השתנה',
    description: 'כשסטטוס של ליד מתעדכן — ידנית או דרך תוצאת שיחה',
    icon: 'arrow-right-arrow-left',
    lifecycle: 'stable',
    requirements: [],
    parameters: [],
    fields: [
      ...LEAD_FIELDS,
      // The status the lead moved INTO, as of the event — a snapshot, decided
      // at emission. Distinct from the LIVE `status` field above: "it moved to
      // contacted" is not the same question as "it is still contacted", and
      // premise-expiry is the second one.
      {
        key: 'newStatus',
        type: 'enum',
        label: 'הסטטוס החדש',
        freshness: 'snapshot',
        lifecycle: 'stable',
        options: LEAD_STATUS_OPTIONS,
      },
    ],
    identity: {
      occurrenceKey: 'status_changed:{newStatus}:{occurredAtMs}',
      leadResolution: 'the lead whose status was just written — agency-scoped by the updating action',
    },
  },
  {
    key: 'appointment.booked',
    /**
     * INTERNAL, not external. The occurrence is now produced by our own domain
     * write — a rep booking a meeting in the CRM — exactly like `lead.created`
     * and `lead.status_changed`. It was `external` when the only producer was a
     * third-party scheduling webhook.
     */
    origin: 'internal',
    subject: 'appointment',
    title: 'נקבעה פגישה',
    description: 'כשנקבעת פגישה עם ליד במערכת',
    icon: 'calendar-check',
    lifecycle: 'stable',
    /**
     * NO REQUIREMENT. Every agency can book a meeting, so there is nothing to
     * connect and nothing to gate. The previous `calendar_connected` lock was
     * satisfiable only by a scheduling connector, which meant this event — and
     * both appointment templates behind it — could never unlock for anyone.
     */
    requirements: [],
    /**
     * No parameters. The remote "which event type to listen to" picker belonged
     * to a scheduling connector; a meeting booked in the CRM has no event types
     * to choose between, and leaving the control declared would render an empty
     * dropdown that can never be filled.
     */
    parameters: [],
    fields: APPOINTMENT_FIELDS,
    identity: {
      occurrenceKey: 'appointment:meeting:{meetingId}',
      leadResolution: 'the lead the meeting is already attached to (meetings.lead_id); a meeting with no lead emits nothing',
    },
  },
  {
    key: 'form.submitted',
    origin: 'external',
    subject: 'form',
    title: 'נשלח טופס באתר',
    description: 'כשמישהו ממלא טופס באתר האינטרנט שלכם',
    icon: 'file-lines',
    lifecycle: 'stable',
    requirements: [
      {
        type: 'connection',
        key: 'website_connected',
        cta: { label: 'חיבור האתר', href: '/settings/connections' },
      },
    ],
    // One remote parameter: which form to listen to. Same control as every
    // other enum_remote — a calendar picker and a form picker are one thing.
    parameters: [
      {
        key: 'formId',
        type: 'enum_remote',
        label: 'הטופס',
        help: 'אפשר להגביל את האוטומציה לטופס אחד',
        optionSource: 'forms',
      },
    ],
    fields: FORM_FIELDS,
    identity: {
      occurrenceKey: 'form:{connection}:{submission_id}',
      leadResolution:
        'the lead the connector created or matched for this submission — by prior submission id, then by phone, then by email, within the agency',
    },
  },
]
