import { actionKeyForEngineAction } from './catalog/engineBridge'

/**
 * Which action an automation runs, and with what.
 *
 * Storage keeps a LIST (frozen spec); V1 executes exactly one entry. Keeping
 * that "one" in a single named place means the day the engine executes many,
 * the change is here and in the worker's loop — not scattered across every
 * caller that happened to write `actions[0]`.
 *
 * The `action` column is the engine's original single-action field and is
 * still the authority for rows written before the actions list existed. It is
 * read through the permanent key bridge, never compared to a literal — which
 * is what keeps "action == email" out of the engine.
 */

export type ActionEntryLike = { actionKey: string; parameters: Record<string, unknown> }

type DefinitionLike = {
  actions?: readonly ActionEntryLike[] | null
  /** The engine's persisted single-action value (e.g. `send_email`). */
  action?: string | null
}

/** The entry V1 executes: the first, or nothing if the list is empty. */
export function actionEntryFor(def: DefinitionLike): ActionEntryLike | null {
  return def.actions?.[0] ?? null
}

/**
 * The CATALOG action key to execute. Falls back to the engine column via the
 * bridge so a row that predates the actions list still runs; an unmappable
 * value yields null and the worker fails closed.
 */
export function actionKeyFor(def: DefinitionLike): string | null {
  const entry = actionEntryFor(def)
  if (entry?.actionKey) return entry.actionKey
  return def.action ? actionKeyForEngineAction(def.action) : null
}

/** The stored parameters for that entry. Shape is the action's own business. */
export function actionParameters(def: DefinitionLike): Record<string, unknown> {
  return actionEntryFor(def)?.parameters ?? {}
}

/**
 * COMPATIBILITY PROJECTION — `content` → action parameters.
 *
 * `content.{subject,body}` is the pre-catalog carrier for what are, in catalog
 * terms, `email.send`'s two parameters. Until the Builder writes
 * `actions[].parameters` directly, the two must never disagree — so this is
 * the ONE place the projection happens, used by every writer and by the
 * read-time synthesis alike.
 *
 * Owner: the Action Executor work. Removal: when `content` stops being the
 * authored surface (see docs/customer-automation-compatibility-audit.md).
 */
export function actionParametersFromContent(content: { subject: string; body: string }): Record<string, unknown> {
  return { subject: content.subject, body: content.body }
}

/** The stored actions list for a content document — the writers' single form. */
export function actionsForContent(actionKey: string, content: { subject: string; body: string }): ActionEntryLike[] {
  return [{ actionKey, parameters: actionParametersFromContent(content) }]
}
