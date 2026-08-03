import type { Condition } from './conditions'
import { findField } from './conditions'
import type { EventDefinition, FieldDefinition } from './catalog/types'
import type { ConditionOperator, FieldFreshness } from './catalog/vocabularies'

/**
 * THE GENERAL CONDITION EVALUATOR.
 *
 * Frozen architecture §6: a condition is `field · operator · value`, where the
 * field comes from the event's declared `fields` and the operators come from
 * that field's TYPE. This module evaluates exactly that, for any event, from
 * catalog metadata alone. It names no field, no status, no source and no
 * integration — which is why deleting the legacy `targetStatus` /
 * `sourceFilter` projection costs nothing in capability.
 *
 * FRESHNESS decides WHERE a condition is evaluated, not whether:
 *
 *   snapshot — the value as of the event. It cannot change afterwards, so
 *              evaluating it at emission gives the same answer as evaluating
 *              it at execution, and saves queuing work that cannot succeed.
 *   live     — re-read from the subject at execution. Evaluating this early
 *              would be reading stale data (Law 6), so it is evaluated at the
 *              send moment and a failure means the premise has expired.
 *
 * Law 3 throughout: an unknown field, an operator the field's type does not
 * allow, or a value the evaluator cannot decide is UNDECIDABLE — never a
 * silent pass. The callers fail closed.
 */

export type FieldValues = Record<string, unknown>

const text = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return null
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const time = (v: unknown): number | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  const raw = text(v)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

const present = (v: unknown): boolean => v != null && String(v).trim() !== ''

/** `a,b,c` — the stored form of a multi-value condition. */
const list = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

type Evaluator = (actual: unknown, expected: string) => boolean | null

/**
 * Exhaustive by construction: `Record<ConditionOperator, …>` means adding an
 * operator to the vocabulary without deciding its meaning is a compile error.
 * `null` from an evaluator means UNDECIDABLE, which the callers fail closed on.
 */
const OPERATORS: Record<ConditionOperator, Evaluator> = {
  is: (a, e) => text(a) === e,
  is_not: (a, e) => text(a) !== e,
  // Substring, exactly as the label "מכיל" says. For the namespaced values the
  // system writes (`facebook:123`, `whatsapp:{id}`) this is equivalent to the
  // prefix match the deleted `sourceFilterMatches` performed — proven by test.
  contains: (a, e) => (text(a) ?? '').includes(e),
  is_one_of: (a, e) => list(e).includes(text(a) ?? ''),
  equals: (a, e) => {
    const [x, y] = [num(a), num(e)]
    return x == null || y == null ? null : x === y
  },
  greater_than: (a, e) => {
    const [x, y] = [num(a), num(e)]
    return x == null || y == null ? null : x > y
  },
  less_than: (a, e) => {
    const [x, y] = [num(a), num(e)]
    return x == null || y == null ? null : x < y
  },
  before: (a, e) => {
    const [x, y] = [time(a), time(e)]
    return x == null || y == null ? null : x < y
  },
  after: (a, e) => {
    const [x, y] = [time(a), time(e)]
    return x == null || y == null ? null : x > y
  },
  between: (a, e) => {
    const [from, to] = list(e).map(time)
    const x = time(a)
    return x == null || from == null || to == null ? null : x >= from && x <= to
  },
  exists: (a) => present(a),
  not_exists: (a) => !present(a),
  is_true: (a) => a === true || text(a) === 'true',
  is_false: (a) => a === false || text(a) === 'false',
}

export type ConditionVerdict =
  | { pass: true; undecidable: null }
  /** `undecidable` names the condition that could not be decided, for logging. */
  | { pass: false; undecidable: string | null }

const PASS: ConditionVerdict = { pass: true, undecidable: null }

/** Evaluate ONE condition against one value. `null` ⇒ undecidable. */
export function evaluateCondition(field: FieldDefinition, condition: Condition, actual: unknown): boolean | null {
  const evaluator = OPERATORS[condition.operator]
  if (!evaluator) return null
  return evaluator(actual, String(condition.value ?? ''))
}

/** Conditions on fields of the given freshness. */
export function conditionsWithFreshness(
  event: EventDefinition,
  conditions: readonly Condition[],
  freshness: FieldFreshness,
): Condition[] {
  return conditions.filter((c) => findField(event, c.field)?.freshness === freshness)
}

/**
 * Conditions naming a field the event does not declare.
 *
 * These belong to NEITHER freshness partition, so without this they would be
 * silently dropped by both evaluation points and the automation would run
 * unguarded — the exact failure Law 3 exists to prevent. Both entry points
 * fail closed on a non-empty result.
 */
export function unknownConditionFields(event: EventDefinition, conditions: readonly Condition[]): string[] {
  return conditions.filter((c) => !findField(event, c.field)).map((c) => c.field)
}

/**
 * Evaluate a set of conditions (AND-only — Law: no OR, no nesting). A missing
 * field, an unusable operator or an undecidable comparison FAILS the set: the
 * engine never acts on a condition it could not evaluate.
 */
export function evaluateConditions(
  event: EventDefinition,
  conditions: readonly Condition[],
  values: FieldValues,
): ConditionVerdict {
  for (const condition of conditions) {
    const field = findField(event, condition.field)
    if (!field) return { pass: false, undecidable: condition.field }
    const result = evaluateCondition(field, condition, values[condition.field])
    if (result === null) return { pass: false, undecidable: condition.field }
    if (!result) return { pass: false, undecidable: null }
  }
  return PASS
}

/**
 * Conditions on fields whose value is fixed at the event. Evaluated at
 * emission: a definition that cannot match this occurrence never gets a job.
 */
export function snapshotConditionsMatch(
  event: EventDefinition,
  conditions: readonly Condition[],
  snapshot: FieldValues,
): ConditionVerdict {
  const unknown = unknownConditionFields(event, conditions)
  if (unknown.length > 0) return { pass: false, undecidable: unknown[0] }
  return evaluateConditions(event, conditionsWithFreshness(event, conditions, 'snapshot'), snapshot)
}

/**
 * Conditions on fields re-read from the subject at execution. A failure here
 * means the premise that justified the send no longer holds.
 */
export function liveConditionsHold(
  event: EventDefinition,
  conditions: readonly Condition[],
  live: FieldValues,
): ConditionVerdict {
  // Checked here too, not only at emission: execution is the last gate, and a
  // condition nobody could evaluate must never become a send.
  const unknown = unknownConditionFields(event, conditions)
  if (unknown.length > 0) return { pass: false, undecidable: unknown[0] }
  return evaluateConditions(event, conditionsWithFreshness(event, conditions, 'live'), live)
}

/** The live field keys a condition set needs — so callers fetch only those. */
export function liveFieldKeys(event: EventDefinition, conditions: readonly Condition[]): string[] {
  return [...new Set(conditionsWithFreshness(event, conditions, 'live').map((c) => c.field))]
}
