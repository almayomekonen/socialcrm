import type { ActionDefinition, Catalog, EventDefinition, IntegrationDefinition, LawDefinition, SubjectDefinition } from './types'
import { LAW_KEYS } from './vocabularies'
import { SUBJECT_ENTRIES } from './entries/subjects'
import { EVENT_ENTRIES } from './entries/events'
import { ACTION_ENTRIES } from './entries/actions'

const SUBJECTS: readonly SubjectDefinition[] = SUBJECT_ENTRIES
const INTEGRATIONS: readonly IntegrationDefinition[] = []
const EVENTS: readonly EventDefinition[] = EVENT_ENTRIES
const ACTIONS: readonly ActionDefinition[] = ACTION_ENTRIES

const LAWS: readonly LawDefinition[] = [
  { key: 'send_once', title: 'פעם אחת לליד', description: 'כל אוטומציה פועלת על כל ליד פעם אחת בלבד.' },
  { key: 'per_lead_cap', title: 'מכסה יומית לליד', description: 'מגבלת ההודעות האוטומטיות שליד יחיד מקבל ביום.' },
  { key: 'agency_cap', title: 'מכסה יומית לעסק', description: 'תקרת ההודעות האוטומטיות של העסק ליום.' },
  { key: 'suppression', title: 'הסרה מרשימת התפוצה', description: 'ליד שהוסר מרשימת התפוצה לא יקבל אימיילים אוטומטיים.' },
  { key: 'bounce_block', title: 'כתובת לא תקינה', description: 'כתובת שהוחזרה נחסמת לשליחות הבאות.' },
  { key: 'quiet_hours', title: 'שעות שקט', description: 'שליחה מחוץ לחלון הפעילות מוחזקת לחלון הבא.' },
  { key: 'opt_out', title: 'הסרה מהודעות', description: 'ליד שביקש להפסיק לקבל הודעות בערוץ הזה.' },
  { key: 'window_24h', title: 'חלון 24 שעות', description: 'הודעת טקסט חופשי מותרת רק בתוך 24 שעות מהודעת הליד.' },
]

export const catalog: Catalog = {
  subjects: SUBJECTS,
  integrations: INTEGRATIONS,
  events: EVENTS,
  actions: ACTIONS,
  laws: LAWS,
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function listSubjects(): readonly SubjectDefinition[] {
  return catalog.subjects
}

export function listIntegrations(): readonly IntegrationDefinition[] {
  return catalog.integrations
}

export function listLaws(): readonly LawDefinition[] {
  return catalog.laws
}

/** Unknown key ⇒ null. Callers hold the automation inert (Law 3). */
export function getEvent(key: string): EventDefinition | null {
  return catalog.events.find((e) => e.key === key) ?? null
}

export function getAction(key: string): ActionDefinition | null {
  return catalog.actions.find((a) => a.key === key) ?? null
}

export function getLaw(key: string): LawDefinition | null {
  return catalog.laws.find((l) => l.key === key) ?? null
}

/**
 * Events a user may pick, excluding those retired from new automations.
 * A `deprecated` event keeps running for automations that already reference
 * it — it is only hidden from new ones (§4 Q7).
 */
export function listSelectableEvents(): readonly EventDefinition[] {
  return catalog.events.filter((e) => e.lifecycle !== 'deprecated')
}

/**
 * Actions offerable for an event: `requires` × the event's declared field
 * types. This is what makes actions self-filtering with zero per-channel
 * logic — an event with no phone field simply never offers WhatsApp.
 */
export function listActionsForEvent(event: EventDefinition): readonly ActionDefinition[] {
  const available = new Set(event.fields.map((f) => f.type))
  return catalog.actions.filter((a) => a.requires.every((t) => available.has(t)))
}

/** Timing anchors are exactly the event's datetime fields (§7). */
export function listAnchorFields(event: EventDefinition) {
  return event.fields.filter((f) => f.type === 'datetime' && f.lifecycle !== 'deprecated')
}

/** Every law key is documented — guards the cross-reference check in CI. */
export function everyLawDocumented(): boolean {
  const documented = new Set(catalog.laws.map((l) => l.key))
  return LAW_KEYS.every((k) => documented.has(k))
}
