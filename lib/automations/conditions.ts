import type { EventDefinition, FieldDefinition } from './catalog/types'
import { OPERATORS_BY_FIELD_TYPE, type ConditionOperator } from './catalog/vocabularies'

/**
 * Conditions — generated entirely from an event's declared `fields`.
 *
 * Frozen architecture §6: a condition is `field · operator · value`, where the
 * field comes ONLY from the chosen event, the operators come ONLY from that
 * field's type, and the values come ONLY from the field's declared options.
 * Nothing here knows what a lead, a status or an integration is.
 *
 * V1 is AND-only (Law: no OR, no nesting, no branches). The stored shape is a
 * predicate list, so adding a combinator later is additive.
 */

export type Condition = {
  field: string
  operator: ConditionOperator
  value: string
}

export const conditionsAreEmpty = (c: readonly Condition[] | null | undefined) => !c || c.length === 0

/** The operators a field may use — derived from its type, never hand-authored. */
export function operatorsForField(field: FieldDefinition): readonly ConditionOperator[] {
  return OPERATORS_BY_FIELD_TYPE[field.type] ?? []
}

/** Fields a user may filter on: everything the event declares, minus retired ones. */
export function conditionableFields(event: EventDefinition): readonly FieldDefinition[] {
  return event.fields.filter((f) => f.lifecycle !== 'deprecated')
}

export function findField(event: EventDefinition, key: string): FieldDefinition | null {
  return event.fields.find((f) => f.key === key) ?? null
}

/** Operators whose meaning needs no value (the UI hides the value input). */
const VALUELESS: readonly ConditionOperator[] = ['exists', 'not_exists', 'is_true', 'is_false']
export const operatorNeedsValue = (op: ConditionOperator) => !VALUELESS.includes(op)

/** Hebrew for each operator. Generic — no domain vocabulary. */
export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: 'הוא',
  is_not: 'אינו',
  contains: 'מכיל',
  is_one_of: 'אחד מ',
  equals: 'שווה ל',
  greater_than: 'גדול מ',
  less_than: 'קטן מ',
  before: 'לפני',
  after: 'אחרי',
  between: 'בין',
  exists: 'קיים',
  not_exists: 'לא קיים',
  is_true: 'כן',
  is_false: 'לא',
}

/** Renders a value using the field's own declared options, if it has any. */
export function valueLabel(field: FieldDefinition | null, value: string): string {
  const option = field?.options?.find((o) => o.value === value)
  return option?.label ?? value
}

export function describeCondition(event: EventDefinition, c: Condition): string {
  const field = findField(event, c.field)
  const label = field?.label ?? c.field
  const op = OPERATOR_LABELS[c.operator] ?? c.operator
  return operatorNeedsValue(c.operator) ? `${label} ${op} "${valueLabel(field, c.value)}"` : `${label} ${op}`
}

export function validateConditions(event: EventDefinition, conditions: readonly Condition[]): string | null {
  for (const c of conditions) {
    const field = findField(event, c.field)
    if (!field) return 'condition_field_unknown'
    if (!operatorsForField(field).includes(c.operator)) return 'condition_operator_invalid'
    if (operatorNeedsValue(c.operator) && !String(c.value ?? '').trim()) return 'condition_value_required'
    if (field.options && operatorNeedsValue(c.operator) && !field.options.some((o) => o.value === c.value)) {
      return 'condition_value_invalid'
    }
  }
  return null
}

// ── Legacy projection (adapter — the engine is NOT changed) ─────────────────

/**
 * The shipped engine narrows on two dedicated columns: `targetStatus` (its
 * premise-expiry law) and `sourceFilter` (its emission filter). B3 gives the
 * BUILDER the general condition model while leaving those columns — and the
 * engine reading them — exactly as they are.
 *
 * So conditions are stored in full, AND the two the engine understands are
 * projected back onto the legacy columns on every write. Engine behaviour is
 * byte-identical; the Builder no longer has a special case for either.
 *
 * These two field keys are the ONLY place the Builder layer names a field, and
 * they are named as an engine-compatibility concern, not as business logic.
 */
const LEGACY_STATUS_FIELD = 'newStatus'
const LEGACY_SOURCE_FIELD = 'source'

export type LegacyProjection = { targetStatus: string | null; sourceFilter: string | null }

export function projectToLegacyColumns(conditions: readonly Condition[]): LegacyProjection {
  const status = conditions.find((c) => c.field === LEGACY_STATUS_FIELD && c.operator === 'is')
  const source = conditions.find(
    (c) => c.field === LEGACY_SOURCE_FIELD && (c.operator === 'is' || c.operator === 'contains'),
  )
  return { targetStatus: status?.value ?? null, sourceFilter: source?.value ?? null }
}

/**
 * The inverse, for automations written before B3: their intent lives in the
 * legacy columns and is lifted into conditions on read, so an existing
 * automation opens in the new Builder saying exactly what it always meant.
 */
export function liftFromLegacyColumns(input: {
  targetStatus: string | null
  sourceFilter: string | null
}): Condition[] {
  const out: Condition[] = []
  if (input.targetStatus) out.push({ field: LEGACY_STATUS_FIELD, operator: 'is', value: input.targetStatus })
  if (input.sourceFilter) out.push({ field: LEGACY_SOURCE_FIELD, operator: 'contains', value: input.sourceFilter })
  return out
}
