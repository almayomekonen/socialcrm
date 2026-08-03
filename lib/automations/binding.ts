import type { EventDefinition } from './catalog/types'

/**
 * Connection binding — turning a user's parameter answers into the STABLE
 * identities an automation is stored against.
 *
 * The distinction this file exists to hold: an `enum_remote` parameter names a
 * Source (a page, a calendar, a phone number — something the connector owns
 * and can go away), while an `enum_static` parameter is just a choice. Writing
 * a static choice into `sourceIds` would corrupt the binding and make a
 * perfectly healthy automation look connection-broken.
 *
 * The catalog decides which is which. Nothing here inspects a value.
 */

/** The Source ids an automation is bound to, derived from its event's schema. */
export function sourceIdsFrom(event: EventDefinition | null, parameters: Record<string, string> | null | undefined): string[] {
  if (!event) return []
  const answers = parameters ?? {}
  return event.parameters
    .filter((p) => p.type === 'enum_remote')
    .map((p) => answers[p.key])
    .filter((v): v is string => Boolean(v))
}

/**
 * Whether an event needs a Connection chosen before it can be configured. An
 * event with a remote parameter cannot resolve its options without one, so
 * offering the parameter first would be a dead control.
 */
export function needsConnection(event: EventDefinition | null): boolean {
  return Boolean(event?.parameters.some((p) => p.type === 'enum_remote'))
}
