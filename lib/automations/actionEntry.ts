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
export function actionParametersFromContent(content: AuthoredContent): Record<string, unknown> {
  const parameters: Record<string, unknown> = { subject: content.subject, body: content.body }
  // The optional CTA block. Projected only when BOTH halves are present: it is
  // one block, so a half-filled pair is no block at all rather than a button
  // with no destination.
  const label = content.ctaLabel?.trim()
  const url = content.ctaUrl?.trim()
  if (label && url) {
    parameters.ctaLabel = label
    parameters.ctaUrl = url
  }
  /**
   * The messaging action's parameters, projected the same way — present only when
   * the content carries them, so an email automation's parameters are byte-identical
   * to what they were before this action existed.
   */
  if (content.templateId != null) parameters.templateId = content.templateId
  if (content.templateBindings && Object.keys(content.templateBindings).length > 0) {
    parameters.templateBindings = content.templateBindings
  }
  /**
   * `task.create`'s parameter, projected on the same terms. Without this line
   * the executor read `parameters.title` from a record that never carried one
   * and created every task with an empty title — the authored value was stored
   * on `content` and dropped here.
   */
  if (content.title?.trim()) parameters.title = content.title.trim()
  /**
   * The generic bag, spread last: these are the action's OWN declared
   * parameters, answered through the catalog-driven renderer, so for the action
   * that declares them they are authoritative. Absent for every action authored
   * before it existed, which is why the projection is unchanged for email.
   */
  if (content.actionParameters) {
    for (const [key, value] of Object.entries(content.actionParameters)) {
      if (typeof value === 'string' && value.trim()) parameters[key] = value.trim()
    }
  }
  return parameters
}

/** The authored surface this projection reads. */
export type AuthoredContent = {
  subject: string
  body: string
  ctaLabel?: string | null
  ctaUrl?: string | null
  templateId?: number | null
  templateBindings?: Record<string, string> | null
  /** `task.create`'s authored value. Absent for every other action. */
  title?: string | null
  /** Catalog-declared parameter answers, keyed by parameter key. */
  actionParameters?: Record<string, string> | null
}

/** The stored actions list for a content document — the writers' single form. */
export function actionsForContent(actionKey: string, content: AuthoredContent): ActionEntryLike[] {
  return [{ actionKey, parameters: actionParametersFromContent(content) }]
}

/**
 * The AUTHORED half of a stored content document — everything except the
 * version stamp, which the writer re-applies from CONTENT_SCHEMA_VERSION.
 *
 * Exists because duplication used to rebuild the document by naming three
 * fields, which silently dropped every field added after that line was written:
 * the CTA block, the WhatsApp template and its slot bindings. A duplicated
 * messaging automation came out unable to send, and a duplicated email lost its
 * button — with no error either time.
 *
 * Spreading is the fix AND the guarantee: a field added to the content document
 * tomorrow is carried without anyone remembering this function exists.
 */
export function authoredContentOf<T extends { schemaVersion?: number }>(content: T | null | undefined): Omit<T, 'schemaVersion'> {
  const { schemaVersion: _stamped, ...authored } = content ?? ({} as T)
  return authored
}
