/**
 * AI Lead Qualifier — pure qualification helpers (no I/O, unit-tested).
 * The collected fields and the fill-empty merge rule live here so the worker and
 * the state machine share one definition and never overwrite human-entered data.
 */
export type AiState = 'new' | 'ai_qualifying' | 'escalated' | 'dormant' | 'opted_out' | 'human_active'

export const QUALIFICATION_FIELDS = ['name', 'need', 'urgency', 'budget', 'location', 'callback'] as const
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number]

export const CONVERSATION_OBJECTIVES = [
  'discover_need',
  'understand_pain',
  'understand_impact',
  'understand_outcome',
  'advance',
] as const
export type ConversationObjective = (typeof CONVERSATION_OBJECTIVES)[number]

export const COGNITION_FACT_FIELDS = ['pain', 'impact', 'currentWorkflow', 'desiredOutcome'] as const
export type CognitionFactField = (typeof COGNITION_FACT_FIELDS)[number]

export type ConversationCognition = {
  lastObjective?: ConversationObjective
  pain?: string
  impact?: string
  currentWorkflow?: string
  desiredOutcome?: string
}

export type Qualification = Partial<Record<QualificationField, string>> & {
  cognition?: ConversationCognition
}

const isEmpty = (v: unknown): boolean => v == null || String(v).trim() === ''

export function isConversationObjective(v: unknown): v is ConversationObjective {
  return typeof v === 'string' && (CONVERSATION_OBJECTIVES as readonly string[]).includes(v)
}

/**
 * Fill-empty merge for conversational understanding. Facts never overwrite a
 * known value. lastObjective always advances to the latest valid decision.
 */
export function mergeCognition(
  current: ConversationCognition | undefined,
  incoming: ConversationCognition | undefined,
): ConversationCognition | undefined {
  const out: ConversationCognition = { ...(current ?? {}) }
  if (incoming?.lastObjective && isConversationObjective(incoming.lastObjective)) {
    out.lastObjective = incoming.lastObjective
  }
  for (const f of COGNITION_FACT_FIELDS) {
    if (isEmpty(out[f]) && !isEmpty(incoming?.[f])) out[f] = String(incoming?.[f]).trim()
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Fill-empty merge: copies an extracted value into the result ONLY when the
 * current field is empty. Never overwrites a value already present (human-entered
 * or previously collected). Trims whitespace. Ignores keys outside the field set.
 * Nested cognition is merged separately and is never treated as a CRM field.
 */
export function mergeQualification(current: Qualification, extracted: Qualification): Qualification {
  const out: Qualification = {}
  for (const f of QUALIFICATION_FIELDS) {
    if (!isEmpty(current[f])) out[f] = String(current[f]).trim()
    else if (!isEmpty(extracted[f])) out[f] = String(extracted[f]).trim()
  }
  const cognition = mergeCognition(current.cognition, extracted.cognition)
  if (cognition) out.cognition = cognition
  return out
}

/** True when every required field has a non-empty value. */
export function requiredComplete(q: Qualification, required: readonly string[]): boolean {
  return required.every((f) => !isEmpty(q[f as QualificationField]))
}
