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
 * Imperative verbs that mean "do it now", in two groups because they are not
 * equally unambiguous.
 *
 * Infinitives are absent from both on purpose: "ליצור" appears in "כדאי
 * ליצור", which is a suggestion, not an order.
 *
 * SECOND-PERSON FUTURE (תיצור, תקבע) is how Hebrew gives an instruction, and in
 * a rep's message it means nothing else — so it counts anywhere in its clause:
 * "את הפגישה תקבע למחר".
 */
const SECOND_PERSON_COMMANDS = [
  'תיצור', 'תצור', 'תפתח', 'תוסיף', 'תזכיר', 'תרשום', 'תקבע', 'תשים', 'תעשה', 'תבצע', 'תעדכן',
]

/**
 * BARE IMPERATIVES AND ENGLISH VERBS are also ordinary words: "קבע" is "he set",
 * "פתח" is "an opening", "open" is an adjective in "show my open leads", "set"
 * is a noun. Anywhere in a sentence they would turn questions into orders — and
 * an order is what lets a write run WITHOUT an approval card. So they count only
 * where an imperative actually sits: at the start of a clause ("קבע משימה",
 * "דני, צור משימה", "create a task").
 */
const CLAUSE_INITIAL_COMMANDS = [
  'צור', 'פתח', 'הוסף', 'רשום', 'קבע', 'שים', 'עשה', 'בצע', 'עדכן',
  'create', 'add', 'open', 'schedule', 'make', 'set', 'remind',
]

/** Courtesy words that may precede the verb without changing what the clause is. */
const CLAUSE_LEAD_INS = ['בבקשה', 'עכשיו', 'רק', 'גם', 'please', 'pls', 'kindly', 'now', 'just', 'also']

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

/**
 * First words that make the whole message a question rather than an order.
 * Matched as a whole first word, so "מהר" is not "מה" and "whatever" is not
 * "what". Deliberately generous: a question misread as a proposal costs one
 * approval click; a question misread as an order writes without asking.
 */
const INTERROGATIVE_OPENERS = [
  'האם', 'מה', 'מהו', 'מהי', 'איך', 'למה', 'מדוע', 'מתי', 'מי', 'כמה', 'איזה', 'איזו', 'אילו', 'איפה', 'היכן', 'יש',
  'what', 'how', 'why', 'when', 'should', 'which', 'who', 'where', 'is', 'are', 'do', 'does', 'did',
  'can', 'could', 'would', 'will',
]

/**
 * Hebrew glues prefixes onto words (ו/ה/ש/ל/ב/כ/מ), so a bare `includes` would
 * match inside unrelated words and a naive `\b` does not work on Hebrew at all.
 * This treats a token as present when it is preceded by a boundary or by one of
 * those prefix letters. HEDGES ONLY: a false positive here demotes to a
 * proposal, which is the safe direction. Never used for anything that grants.
 */
function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s,.!?"'׳״\\-–—])[והשלבכמ]?${escaped}`, 'i').test(text)
}

const hasAny = (text: string, tokens: string[]) => tokens.some((t) => hasToken(text, t))

/**
 * The strict matcher for anything that GRANTS: the token must be a whole word,
 * bounded on BOTH sides, with at most the conjunction ו in front ("ותיצור").
 *
 * The permissive `hasToken` above had no trailing boundary and accepted every
 * prefix letter, which is how "בצורה" contained "צור", "שקבעתי" contained
 * "קבע", "צורך" contained "צור", and "yesterday" contained "yes". Each of those
 * turned an ordinary message into an explicit command.
 */
const WORD_EDGE = `[\\s,.!?"'׳״:;()\\-–—]`
function hasWord(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|${WORD_EDGE})ו?${escaped}(?=$|${WORD_EDGE})`, 'i').test(text)
}

const hasAnyWord = (text: string, tokens: string[]) => tokens.some((t) => hasWord(text, t))

function words(clause: string): string[] {
  return clause
    .split(/\s+/)
    .map((w) => w.replace(/^["'׳״(]+|["'׳״)]+$/g, '').toLowerCase())
    .filter(Boolean)
}

function isVerb(word: string, verbs: readonly string[]): boolean {
  return verbs.includes(word) || (word.startsWith('ו') && verbs.includes(word.slice(1)))
}

/**
 * Does the message carry an instruction? Per clause: a second-person command
 * anywhere in it, or a bare imperative / English verb as its first real word.
 */
function hasCommand(text: string): boolean {
  for (const clause of text.split(/[\n,.!;:?()]+|\s[-–—]\s/)) {
    const w = words(clause)
    let i = 0
    while (i < w.length && CLAUSE_LEAD_INS.includes(w[i])) i++
    if (i < w.length && (isVerb(w[i], CLAUSE_INITIAL_COMMANDS) || isVerb(w[i], SECOND_PERSON_COMMANDS))) return true
    if (w.some((x) => isVerb(x, SECOND_PERSON_COMMANDS))) return true
  }
  return false
}

/** A question asks; it does not instruct — by its first word, or by a "?" anywhere. */
function isQuestion(text: string): boolean {
  if (text.includes('?')) return true
  const first = words(text)[0] ?? ''
  return INTERROGATIVE_OPENERS.includes(first)
}

export type IntentInput = {
  /** The authenticated request's own question. Never model output. */
  userMessage: string
  /**
   * The assistant turn immediately before it, when there is one. Used ONLY to
   * decide whether a bare affirmation has something to affirm — never as
   * evidence, and never to widen what the affirmation authorises.
   */
  priorAssistantMessage?: string | null
  /**
   * The USER'S OWN recent turns, newest first — never the assistant's.
   *
   * A command survives the conversation that completes it. "תיצור לי משימה
   * לדניאל" followed by "לחזור לדניאל" is one instruction being filled in, not
   * an instruction and then a stray phrase, and making the rep re-issue the verb
   * at the end is exactly the form-wizard behaviour this is meant to remove.
   */
  priorUserMessages?: readonly string[]
}

/**
 * How far back a standing command reaches.
 *
 * Three turns covers a real slot-filling exchange — target, then date, then
 * title — and stops well short of letting an instruction from earlier in a long
 * session authorise something the rep has since moved on from.
 *
 * THE WINDOW IS THE OUTER BOUND, NEVER THE RULE. A command is spent the moment
 * it produces its action, whether that took one turn or three; the caller
 * establishes that from the durable record and simply stops passing prior turns.
 * See `STANDING_COMMAND_WINDOW_MS` in the bridge.
 */
export const COMMAND_CARRY_TURNS = 3

/**
 * CONTEXT IS NOT AUTHORIZATION, and the two must not be conflated.
 *
 * The conversation may go on knowing perfectly well that the active lead is
 * דניאל כהן, that the last task was called "לחזור לדניאל", and that the date in
 * play is 2026-09-07. All of that is CONTEXT: it lets the model resolve "אותו
 * ליד" and inherit a note, and it may outlive any number of turns.
 *
 * None of it is permission to mutate. Authorization comes from the rep's current
 * turn — an instruction, or an affirmation of something just proposed — or from
 * that turn completing an instruction still in progress. A message that merely
 * arrives while the system happens to remember things authorises nothing.
 */

export function deriveActionIntent(input: IntentInput): IntentVerdict {
  const text = (input.userMessage ?? '').trim()
  if (!text) return PROPOSAL

  // A hedge anywhere demotes the whole message. Checked first so no verb can
  // rescue "אולי כדאי ליצור משימה".
  if (hasAny(text, HEDGES)) return { intent: 'AGENT_PROPOSAL', reason: 'hedged-request' }

  // A question asks; it does not instruct.
  if (isQuestion(text)) return { intent: 'AGENT_PROPOSAL', reason: 'interrogative' }

  if (hasCommand(text)) return { intent: 'EXPLICIT_COMMAND', reason: 'imperative-verb' }

  if (hasAnyWord(text, AFFIRMATIONS)) {
    // "כן, תעשה" only means yes if something was said to agree with.
    if (!input.priorAssistantMessage?.trim()) {
      return { intent: 'AGENT_PROPOSAL', reason: 'affirmation-without-context' }
    }
    return { intent: 'EXPLICIT_COMMAND', reason: 'affirmation-of-prior-turn' }
  }

  /**
   * A STANDING COMMAND, still being filled in.
   *
   * Reached only after every demotion above has declined to fire, so the current
   * message is neither a question nor hedged — it is a bare value like a title
   * or a name. If one of the rep's own recent turns was an unambiguous
   * instruction, this turn is completing it. Live conversation is what showed
   * this was missing: "תיצור לי משימה עבור דניאל כהן" → "למחר בשעה 10:00" →
   * "לחזור לדניאל" put an approval card in front of a rep who had already given
   * the order and was answering the agent's own question.
   *
   * The prior turn is judged by these same rules, on the USER'S words, so
   * nothing here can be inherited from something the model wrote.
   */
  const recent = (input.priorUserMessages ?? []).slice(0, COMMAND_CARRY_TURNS)
  for (const prior of recent) {
    const priorText = (prior ?? '').trim()
    if (!priorText) continue
    if (hasAny(priorText, HEDGES)) continue
    if (isQuestion(priorText)) continue
    if (hasCommand(priorText)) {
      return { intent: 'EXPLICIT_COMMAND', reason: 'continues-prior-command' }
    }
  }

  return PROPOSAL
}
