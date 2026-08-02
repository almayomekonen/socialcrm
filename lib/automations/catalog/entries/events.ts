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
      // Captured at emission from the lead row; the engine's pre-catalog
      // `sourceFilter` narrows on this. B3 replaces that with a condition.
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
      // The status the lead moved INTO, as of the event. The engine's
      // premise-expiry law compares this against the definition's
      // targetStatus; B3 expresses that as a condition on this field.
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
]
