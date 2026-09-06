/**
 * Did the PERSON ask for this, or did the agent think of it?
 *
 * THIS IS THE AUTHORIZATION QUESTION, and it is why `WRITE == APPROVAL` was the
 * wrong rule. A rep who types "תיצור לי משימה להתקשר ליוסי ב-8/9" has already
 * decided; showing them a card that asks whether they meant it is not a safety
 * feature, it is the product failing to listen. But an agent that noticed 25
 * cold leads and thought a follow-up would help has decided nothing on the rep's
 * behalf, and must not act. Same action, same arguments, same risk — opposite
 * correct behaviour, and the only thing that separates them is who asked.
 *
 * DERIVED FROM THE USER'S OWN WORDS, NEVER FROM THE MODEL'S. The input here is
 * the question string the authenticated request carried, which the application
 * already holds before any model runs. There is no field a model can fill in to
 * assert that it was told to act — the answer schema has no such property, and
 * `parseActionProposal` strips unknown keys — so "the user authorised this" is
 * never something the model gets to claim.
 *
 * IT FAILS CLOSED, DELIBERATELY. Anything this cannot read as a clear
 * instruction is AGENT_PROPOSAL, which routes to approval. The cost of a false
 * negative is one extra tap on a card the product already renders; the cost of a
 * false positive is a mutation nobody asked for. Those are not comparable, so
 * the matching is narrow on purpose and every hedge demotes.
 *
 * A NOTE ON WHAT THIS IS NOT. It is not natural-language understanding and does
 * not try to be. It recognises a small set of imperative forms and
 * affirmations — the shapes a person actually uses when telling software to do
 * something — and treats everything else as a suggestion. A model call to
 * classify intent would be both slower and, far worse, would put the model back
 * in charge of deciding whether it was authorised.
 */

export const ACTION_INTENTS = ['EXPLICIT_COMMAND', 'AGENT_PROPOSAL'] as const
export type ActionIntent = (typeof ACTION_INTENTS)[number]

export type IntentVerdict = {
  intent: ActionIntent
  /** Why, for the audit row. Never shown to a user. */
  reason: string
}

const PROPOSAL: IntentVerdict = { intent: 'AGENT_PROPOSAL', reason: 'no-explicit-instruction' }

/**
 * Imperative verbs that mean "do it now".
 *
 * Second-person future used as a command (תיצור) and bare imperative (צור) —
 * the two forms Hebrew actually uses for instructions. Infinitives are absent on
 * purpose: "ליצור" appears in "כדאי ליצור", which is a suggestion, not an order.
 */
const COMMAND_VERBS = [
  'תיצור', 'תצור', 'צור', 'תפתח', 'פתח', 'תוסיף', 'הוסף', 'תזכיר', 'תרשום', 'רשום',
  'קבע', 'תקבע', 'תשים', 'שים', 'עשה', 'תעשה', 'בצע', 'תבצע', 'תעדכן', 'עדכן',
  'create', 'add', 'open', 'schedule', 'make', 'set', 'remind',
]

/**
 * Affirmations — the second half of "agent suggests, user agrees".
 *
 * These only count when something preceded them. A bare "כן" opening a
 * conversation agrees with nothing.
 */
const AFFIRMATIONS = [
  'כן', 'בסדר', 'אוקיי', 'אוקי', 'סבבה', 'מאשר', 'מאשרת', 'אשר', 'תאשר', 'אישור', 'קדימה',
  'יאללה', 'בטח', 'ok', 'okay', 'yes', 'sure', 'approved', 'confirm', 'go ahead', 'do it',
]

/**
 * Words that turn an instruction back into a suggestion.
 *
 * "אולי תיצור משימה" carries a command verb and is still not a command. The
 * hedge wins, always — this list is checked before the verbs are.
 */
const HEDGES = [
  'אולי', 'כדאי', 'ממליץ', 'ממליצה', 'המלצה', 'שווה', 'מה דעתך', 'עדיף',
  'האם', 'צריך ש', 'רעיון', 'שקול', 'maybe', 'should i', 'recommend', 'suggest', 'perhaps',
]

/** Openers that make the whole sentence a question rather than an order. */
const INTERROGATIVE_OPENERS = ['האם', 'מה ', 'איך', 'למה', 'מתי', 'מי ', 'כמה', 'what', 'how', 'why', 'when', 'should']

/**
 * Hebrew glues prefixes onto words (ו/ה/ש/ל/ב/כ/מ), so a bare `includes` would
 * match inside unrelated words and a naive `\b` does not work on Hebrew at all.
 * This treats a token as present when it is preceded by a boundary or by one of
 * those prefix letters.
 */
function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s,.!?"'׳״\\-–—])[והשלבכמ]?${escaped}`, 'i').test(text)
}

const hasAny = (text: string, tokens: string[]) => tokens.some((t) => hasToken(text, t))

export type IntentInput = {
  /** The authenticated request's own question. Never model output. */
  userMessage: string
  /**
   * The assistant turn immediately before it, when there is one. Used ONLY to
   * decide whether a bare affirmation has something to affirm — never as
   * evidence, and never to widen what the affirmation authorises.
   */
  priorAssistantMessage?: string | null
}

export function deriveActionIntent(input: IntentInput): IntentVerdict {
  const text = (input.userMessage ?? '').trim()
  if (!text) return PROPOSAL

  // A hedge anywhere demotes the whole message. Checked first so no verb can
  // rescue "אולי כדאי ליצור משימה".
  if (hasAny(text, HEDGES)) return { intent: 'AGENT_PROPOSAL', reason: 'hedged-request' }

  // A question asks; it does not instruct.
  const opener = text.toLowerCase()
  if (INTERROGATIVE_OPENERS.some((q) => opener.startsWith(q))) {
    return { intent: 'AGENT_PROPOSAL', reason: 'interrogative' }
  }

  if (hasAny(text, COMMAND_VERBS)) return { intent: 'EXPLICIT_COMMAND', reason: 'imperative-verb' }

  if (hasAny(text, AFFIRMATIONS)) {
    // "כן, תעשה" only means yes if something was said to agree with.
    if (!input.priorAssistantMessage?.trim()) {
      return { intent: 'AGENT_PROPOSAL', reason: 'affirmation-without-context' }
    }
    return { intent: 'EXPLICIT_COMMAND', reason: 'affirmation-of-prior-turn' }
  }

  return PROPOSAL
}
