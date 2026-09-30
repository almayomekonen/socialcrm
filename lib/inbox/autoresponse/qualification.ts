/**
 * AI Lead Qualifier — pure qualification helpers (no I/O, unit-tested).
 * The collected fields and the fill-empty merge rule live here so the worker and
 * the state machine share one definition and never overwrite human-entered data.
 */
export type AiState =
  | 'new'
  | 'ai_qualifying'
  | 'escalated'
  | 'dormant'
  | 'opted_out'
  | 'human_active'
  | 'closed'

/**
 * `businessType` is what the customer's business DOES ("מספרת כלבים", "מוסך"),
 * which is not its name. The transcript that prompted this had the customer
 * answer "קרן מקונן / עסק למספרת כלבים" to a request for a name and a business
 * name — there was no business name to give, and the trade is the useful fact.
 * Keeping it in its own field is what lets the operator note show it without
 * anyone inventing a company name.
 */
export const QUALIFICATION_FIELDS = [
  'name',
  'businessType',
  'need',
  'urgency',
  'budget',
  'location',
  'callback',
] as const
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

export const SALES_STRATEGIES = [
  'discover',
  'product_fit',
  'explain',
  'how_it_works',
  'next_step',
] as const
export type SalesStrategy = (typeof SALES_STRATEGIES)[number]

export function isSalesStrategy(v: unknown): v is SalesStrategy {
  return typeof v === 'string' && (SALES_STRATEGIES as readonly string[]).includes(v)
}

export function isProductStrategy(v: SalesStrategy | null | undefined): boolean {
  return v === 'product_fit' || v === 'explain' || v === 'how_it_works' || v === 'next_step'
}

export type ConversationCognition = {
  lastObjective?: ConversationObjective
  salesStrategy?: SalesStrategy
  pain?: string
  impact?: string
  currentWorkflow?: string
  desiredOutcome?: string
}

/**
 * Ownership epoch, written only by `returnConversationToAgent`: the highest
 * message sequence at the moment a rep handed the conversation back. Human
 * outbounds at or below it belong to the period the rep just ended and no
 * longer count as a takeover (reliability/ownership.ts). Never model output.
 */
export type OwnershipEpoch = { sinceSequence: number; returnedAt?: string }

export type Qualification = Partial<Record<QualificationField, string>> & {
  cognition?: ConversationCognition
  ownership?: OwnershipEpoch
}

const isEmpty = (v: unknown): boolean => v == null || String(v).trim() === ''

export function isConversationObjective(v: unknown): v is ConversationObjective {
  return typeof v === 'string' && (CONVERSATION_OBJECTIVES as readonly string[]).includes(v)
}

/**
 * Fields the customer explicitly corrected on this turn. See
 * {@link mergeQualification} for why a correction is a separate signal rather
 * than a plain overwrite.
 */
export type CorrectedFields = readonly string[]

function correctedSet(corrected: CorrectedFields | undefined): Set<string> {
  return new Set((corrected ?? []).map((f) => String(f).trim()).filter(Boolean))
}

/**
 * Fill-empty merge for conversational understanding, with corrections honoured.
 * lastObjective and salesStrategy always advance to the latest valid decision —
 * strategy is "what the AI is doing NOW", not a frozen fact.
 */
export function mergeCognition(
  current: ConversationCognition | undefined,
  incoming: ConversationCognition | undefined,
  corrected?: CorrectedFields,
): ConversationCognition | undefined {
  const out: ConversationCognition = { ...(current ?? {}) }
  const fix = correctedSet(corrected)
  if (incoming?.lastObjective && isConversationObjective(incoming.lastObjective)) {
    out.lastObjective = incoming.lastObjective
  }
  if (incoming?.salesStrategy && isSalesStrategy(incoming.salesStrategy)) {
    out.salesStrategy = incoming.salesStrategy
  }
  for (const f of COGNITION_FACT_FIELDS) {
    if (isEmpty(incoming?.[f])) continue
    if (isEmpty(out[f]) || fix.has(f)) out[f] = String(incoming?.[f]).trim()
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Merge what the agent learned this turn into what it already knew.
 *
 * DEFAULT: fill-empty. A value already present is never replaced by a
 * re-extraction of the same thing worded slightly differently, which is what
 * keeps the agent's memory stable across a long conversation.
 *
 * EXCEPTION: `corrected`. A customer who says "Dana… sorry, Danit" must not be
 * called Dana for the rest of the conversation. Before this, fill-empty made the
 * first value permanent, so the structured memory kept asserting a fact the
 * customer had already retracted — and because the raw transcript was still in
 * context, the prompt then contained both, which is worse than either alone.
 *
 * The overwrite is deliberately gated on an explicit per-turn signal rather than
 * being unconditional last-value-wins: the model has to say "the customer
 * corrected this field", and only the named fields move. That keeps ordinary
 * re-extraction from churning stable values.
 *
 * SCOPE. This is the agent's OWN memory (`conversation_ai_state.qualification`),
 * written only by the agent — `recordTurn` and `mergeOnly` are its sole writers.
 * Human-maintained CRM data lives on `clients` and is not touched here.
 */
export function mergeQualification(
  current: Qualification,
  extracted: Qualification,
  opts?: { corrected?: CorrectedFields },
): Qualification {
  const out: Qualification = {}
  const fix = correctedSet(opts?.corrected)
  for (const f of QUALIFICATION_FIELDS) {
    const incoming = extracted[f]
    const keepCurrent = !isEmpty(current[f]) && !(fix.has(f) && !isEmpty(incoming))
    if (keepCurrent) out[f] = String(current[f]).trim()
    else if (!isEmpty(incoming)) out[f] = String(incoming).trim()
  }
  const cognition = mergeCognition(current.cognition, extracted.cognition, opts?.corrected)
  if (cognition) out.cognition = cognition
  // Not the agent's to change: carried through every merge untouched, so a
  // recorded turn can never erase (or forge) the last return-to-agent.
  if (current.ownership) out.ownership = current.ownership
  return out
}

/** True when every required field has a non-empty value. */
export function requiredComplete(q: Qualification, required: readonly string[]): boolean {
  return required.every((f) => !isEmpty(q[f as QualificationField]))
}
