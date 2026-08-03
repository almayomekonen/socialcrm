import type { EventDefinition, Requirement } from './catalog/types'

/**
 * Requirement Runtime — part of the Connection layer, not a separate feature.
 *
 * Frozen spec §3.4/§4 Q5: three requirement types, three different user
 * experiences. This module is pure and generic: it names no integration, no
 * capability and no plan. It is handed a context of what the agency HAS and
 * reports what each event IS.
 *
 * "No silent failures" is the governing rule — an event the user cannot
 * actually run must never look runnable.
 */

export type RequirementContext = {
  /** Connection capability keys this agency currently satisfies. */
  capabilities: ReadonlySet<string>
  /** Entitlement keys this agency's plan grants. */
  entitlements: ReadonlySet<string>
  /** Rollout flags currently on. */
  flags: ReadonlySet<string>
}

export type EventAvailability =
  | { state: 'available' }
  /** Shown, greyed, with the catalog's own CTA. Never hidden — §4 Q5. */
  | { state: 'locked'; requirement: Requirement }
  /** Runs for existing automations; never offered for new ones. */
  | { state: 'deprecated' }
  /** Flag-gated: invisible. Showing "connect something" would be a lie. */
  | { state: 'hidden' }

const satisfied = (req: Requirement, ctx: RequirementContext): boolean => {
  if (req.type === 'connection') return ctx.capabilities.has(req.key)
  if (req.type === 'entitlement') return ctx.entitlements.has(req.key)
  return ctx.flags.has(req.key)
}

export function evaluateEvent(event: EventDefinition, ctx: RequirementContext): EventAvailability {
  // A flag-gated event the flag does not cover is invisible, whatever else
  // is true — we never advertise something we have not released.
  const flag = event.requirements.find((r) => r.type === 'flag' && !satisfied(r, ctx))
  if (flag) return { state: 'hidden' }

  if (event.lifecycle === 'deprecated') return { state: 'deprecated' }

  const unmet = event.requirements.find((r) => !satisfied(r, ctx))
  if (unmet) return { state: 'locked', requirement: unmet }

  return { state: 'available' }
}

export type EvaluatedEvent = { event: EventDefinition; availability: EventAvailability }

/** Evaluate a whole catalog slice; hidden events are dropped entirely. */
export function evaluateEvents(events: readonly EventDefinition[], ctx: RequirementContext): EvaluatedEvent[] {
  return events
    .map((event) => ({ event, availability: evaluateEvent(event, ctx) }))
    .filter((e) => e.availability.state !== 'hidden')
}

export const isSelectable = (a: EventAvailability) => a.state === 'available'
