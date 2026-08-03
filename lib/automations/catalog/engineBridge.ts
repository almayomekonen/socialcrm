import type { AutomationTriggerEvent, TriggerType } from '../types'

/**
 * LEGACY BRIDGE — catalog keys ↔ the engine's persisted vocabulary.
 *
 * The frozen architecture mandates namespaced catalog keys (`lead.created`,
 * `email.send`). The shipped engine predates it and persists unnamespaced
 * values (`lead_created`, `send_email`) in `automation_jobs.trigger`,
 * `automation_activity.trigger` and `automation_definitions.action` — all
 * under CHECK constraints, all on live production rows.
 *
 * Renaming them would be a migration of meaning over real data for no user
 * benefit, which the engine ADRs forbid. So the catalog carries the correct
 * keys, the database keeps the values it has always had, and this module is
 * the single, explicit place the two vocabularies meet.
 *
 * This bridge is expected to be permanent. It is small, total, and honest —
 * far cheaper than rewriting history to make two strings match.
 */

const EVENT_KEY_TO_ENGINE_TRIGGER: Record<string, TriggerType> = {
  'lead.created': 'lead_created',
  'lead.status_changed': 'status_changed',
  'appointment.booked': 'appointment_booked',
  'form.submitted': 'form_submitted',
}

const ENGINE_TRIGGER_TO_EVENT_KEY: Record<TriggerType, string> = {
  lead_created: 'lead.created',
  status_changed: 'lead.status_changed',
  appointment_booked: 'appointment.booked',
  form_submitted: 'form.submitted',
}

const ACTION_KEY_TO_ENGINE_ACTION: Record<string, string> = {
  'email.send': 'send_email',
}

const ENGINE_ACTION_TO_ACTION_KEY: Record<string, string> = {
  send_email: 'email.send',
}

/** Unknown key ⇒ null. Callers hold the automation inert (Law 3). */
export function engineTriggerForEventKey(eventKey: string): TriggerType | null {
  return EVENT_KEY_TO_ENGINE_TRIGGER[eventKey] ?? null
}

export function eventKeyForEngineTrigger(trigger: string): string | null {
  return ENGINE_TRIGGER_TO_EVENT_KEY[trigger as TriggerType] ?? null
}

export function engineActionForActionKey(actionKey: string): string | null {
  return ACTION_KEY_TO_ENGINE_ACTION[actionKey] ?? null
}

export function actionKeyForEngineAction(action: string): string | null {
  return ENGINE_ACTION_TO_ACTION_KEY[action] ?? null
}

/** Every catalog event key that has an engine counterpart. */
export function bridgedEventKeys(): readonly string[] {
  return Object.keys(EVENT_KEY_TO_ENGINE_TRIGGER)
}

/** Every catalog action key that has an engine counterpart. */
export function bridgedActionKeys(): readonly string[] {
  return Object.keys(ACTION_KEY_TO_ENGINE_ACTION)
}

/**
 * The event contract's snapshot payload, keyed by CATALOG field key.
 *
 * `AutomationTriggerEvent` is the persisted ADR-010 shape and carries
 * `leadSource` / `newStatus`; the catalog calls the same values `source` /
 * `newStatus`. That one naming difference is vocabulary, which is precisely
 * what this module is for — it belongs to the existing permanent bridge rather
 * than becoming a second one somewhere else.
 *
 * Everything the engine knows about an occurrence at emission time is here. A
 * snapshot condition on a field absent from this record is UNDECIDABLE, and
 * the evaluator fails it closed.
 */
export function snapshotFieldsForEvent(event: AutomationTriggerEvent): Record<string, unknown> {
  // A connector's mapped fields are already catalog-keyed and take precedence;
  // the two legacy spellings are merged underneath so the internal events keep
  // working exactly as they did.
  return { source: event.leadSource ?? null, newStatus: event.newStatus ?? null, ...(event.fields ?? {}) }
}
