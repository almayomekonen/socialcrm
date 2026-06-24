/**
 * AI Lead Qualifier — pure qualification helpers (no I/O, unit-tested).
 * The collected fields and the fill-empty merge rule live here so the worker and
 * the state machine share one definition and never overwrite human-entered data.
 */
export type AiState = 'new' | 'ai_qualifying' | 'escalated' | 'dormant' | 'opted_out' | 'human_active'

export const QUALIFICATION_FIELDS = ['name', 'need', 'urgency', 'budget', 'location', 'callback'] as const
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number]
export type Qualification = Partial<Record<QualificationField, string>>

const isEmpty = (v: unknown): boolean => v == null || String(v).trim() === ''

/**
 * Fill-empty merge: copies an extracted value into the result ONLY when the
 * current field is empty. Never overwrites a value already present (human-entered
 * or previously collected). Trims whitespace. Ignores keys outside the field set.
 */
export function mergeQualification(current: Qualification, extracted: Qualification): Qualification {
  const out: Qualification = { ...current }
  for (const f of QUALIFICATION_FIELDS) {
    if (isEmpty(out[f]) && !isEmpty(extracted[f])) out[f] = String(extracted[f]).trim()
  }
  return out
}

/** True when every required field has a non-empty value. */
export function requiredComplete(q: Qualification, required: readonly string[]): boolean {
  return required.every((f) => !isEmpty(q[f as QualificationField]))
}
