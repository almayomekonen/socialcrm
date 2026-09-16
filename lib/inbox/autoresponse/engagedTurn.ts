/**
 * WhatsApp Agent — what a customer message MEANS once the agent owns the thread.
 *
 * THE RULE THIS FILE EXISTS FOR. When the Smart Agent owns a conversation, a new
 * customer message is read in the context of the conversation — not required to
 * independently prove sales intent or match a listed phrase. "טויוטה 2020" is an
 * answer when the agent just asked which car. "מחר" is an answer when it asked
 * when. "רק טיפול" is an answer when it offered two options. None of those
 * sentences means anything on its own, and none of them should have to.
 *
 * WHAT WENT WRONG BEFORE. The gate was a whitelist of intent shapes — a real
 * question, a stated pain, an explicit "I need help", a recognised sales move —
 * evaluated on the current message in near-isolation. Measured against ten
 * direct answers to the agent's own questions across a garage, a clinic and
 * SocialCRM, NINE were classified as no intent and silently dropped. The agent
 * asked a question and then ignored the reply. A whitelist cannot express "this
 * is an answer", because an answer's meaning lives in the question, not in
 * itself.
 *
 * SO THE DEFAULT INVERTS, BUT ONLY HERE. On an engaged conversation the agent
 * replies unless there is a positive reason not to, and the reasons are few and
 * concrete: nothing was said (emoji, punctuation), the customer asked us to hold
 * on, they repeated themselves verbatim, or they are closing the conversation.
 * Before the agent has spoken the old whitelist still governs — an unowned
 * thread is not a conversation yet, and a stranger's stray word deserves silence.
 *
 * THE DELIBERATE COST. In an engaged conversation with an open question, a
 * genuinely meaningless message ("יחרא") now gets a reply asking what they
 * meant, rather than silence. That is the right trade: no deterministic rule can
 * tell "מכבי" from noise without a dictionary of every possible answer, and the
 * two failures are not equal. Answering noise once is briefly awkward. Dropping
 * a real answer ends the conversation permanently, which is what production
 * conversation 6694 did.
 *
 * WHAT THIS FILE IS NOT. It decides MEANING only, never PERMISSION. Whether the
 * agent is enabled, whether this tenant owns the conversation, whether the
 * customer opted out, whether a human took over, whether the conversation is
 * closed, whether a duplicate is in flight — none of that is asked or answered
 * here. Those are authorization, they are deterministic, they are decided in
 * decidePreGeneration and assertAgentSendAllowed, and a permissive reading of a
 * sentence must never be able to loosen one of them. Keeping the two apart is
 * why widening this file is safe.
 */
import {
  isCasualAcknowledgement,
  isDeadEndUtterance,
  isHoldOnUtterance,
  isShortAffirmative,
  collapseRepeatedLetters,
  stripClassificationEmoji,
} from './salesIntent'

export type EngagedTurnReason =
  /** The agent asked something and this is the reply, whatever its length. */
  | 'ANSWERS_OPEN_QUESTION'
  /** No question pending, but the customer said something substantive. */
  | 'ENGAGED_CONTENT'
  /** The customer asked us something. Always outranks every silence below. */
  | 'REAL_QUESTION'
  /** A bare "כן" with nothing outstanding to say yes to. */
  | 'SHORT_AFFIRMATIVE'
  /** "אני אחשוב על זה" — parking the conversation, with nothing asked. */
  | 'DEFERRAL'
  /** The customer is ending the conversation. Silence is the correct reply. */
  | 'CLOSING_ACKNOWLEDGEMENT'
  /** Emoji, punctuation, fewer than two letters. Nothing was said. */
  | 'LOW_INFORMATION'
  /** "רגע", "שנייה" — they are still composing. Wait for the real message. */
  | 'HOLD_ON'
  /** Byte-for-byte the previous customer message, with no question open. */
  | 'NO_NEW_CONTENT'
  /** A bare greeting repeated into a conversation that is already under way. */
  | 'GREETING_REPEAT'

export type EngagedTurnDecision = { answer: boolean; reason: EngagedTurnReason }

export type EngagedTurnFacts = {
  /**
   * The agent's last customer-facing message asked a question, so an answer is
   * outstanding. This is what makes a two-word reply meaningful.
   */
  agentAwaitingAnswer: boolean
  inboundText: string
  /** The customer's previous message, for verbatim-repeat detection. */
  previousCustomerText?: string
  /** A bare greeting, per the caller's own greeting predicate. */
  isGreetingOnly?: boolean
  /**
   * The message asks us something, per the caller's own predicate.
   *
   * Supplied rather than computed so there is exactly one definition of "a real
   * question" in the agent, shared with Conversation Control.
   */
  containsRealQuestion?: boolean
}

const answer = (reason: EngagedTurnReason): EngagedTurnDecision => ({ answer: true, reason })
const silent = (reason: EngagedTurnReason): EngagedTurnDecision => ({ answer: false, reason })

/**
 * Did the customer actually say nothing — emoji, punctuation, a stray character?
 *
 * DIGITS COUNT AS CONTENT, and that is the whole reason this exists rather than
 * reusing `isLowInformationInbound`, which counts letters only. Asked "which
 * year?" a customer answers "2019". Asked "how many leads a month?" they answer
 * "200". Asked to pick an option they answer "1". Every one of those was read as
 * nothing-was-said and dropped.
 *
 * The opening gate deliberately keeps the letters-only rule: a stranger whose
 * first-ever message is "2020" has not started a conversation, while the same
 * string after "which year?" is the answer. Same text, different meaning,
 * because meaning comes from the conversation — which is this file's thesis.
 */
export function saysNothing(text: string): boolean {
  const t = stripClassificationEmoji(text ?? '').trim()
  if (!t) return true
  const letters = t.match(/[A-Za-z֐-׿]/g) ?? []
  const digits = t.match(/\d/g) ?? []
  return letters.length < 2 && digits.length < 1
}

function normalize(text: string): string {
  return collapseRepeatedLetters(
    stripClassificationEmoji(text ?? '')
      .toLowerCase()
      .replace(/[?!.,;:־…]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/**
 * Is the customer ending the conversation, rather than answering it?
 *
 * The distinction the product rule turns on: a genuine closing acknowledgement
 * needs no reply, but an answer must never be discarded for being short. Both
 * are short, so length cannot be the test — the test is whether the utterance
 * is *only* an acknowledgement or a sign-off.
 */
export function isClosingAcknowledgement(text: string): boolean {
  return isCasualAcknowledgement(text) || isDeadEndUtterance(text)
}

/**
 * "I'll think about it" — the customer is parking the conversation.
 *
 * Checked ONLY when no question is outstanding, and that ordering is the whole
 * design. "מחר" is deliberately absent from this list: as an answer to "when is
 * convenient?" it is one of the replies this work exists to stop dropping, and
 * with a question open the answer branch settles it long before we get here.
 * What is left for this predicate is the unprompted deferral, where a cheerful
 * follow-up reads as pressure rather than help.
 */
const DEFERRAL_RE =
  /אחשוב על|נחשוב על|אני אחשוב|צרי[ךכ] לחשוב|נדבר (?:אחר כך|בהמשך|מאוחר יותר|מחר)|לא עכשיו|אחזור אלי(?:כם|ך)|נחזור לזה|\bi(?:'|’)?ll think\b|\bthink about it\b|\bget back to you\b|\bnot right now\b|\bmaybe later\b/i

export function isConversationDeferral(text: string): boolean {
  return DEFERRAL_RE.test(text ?? '')
}

/**
 * A sign-off, or a request to wait — as the WHOLE message.
 *
 * Anchored deliberately. "רגע, כמה זה עולה?" is a question with a filler word
 * in front of it and must not be silenced; a bare "רגע" is someone asking for a
 * moment. The difference is whether the utterance is only the phrase.
 */
const SIGN_OFF_RE =
  /^(?:לילה טוב|ליל מנוחה|שבת שלום|שבוע טוב|חג שמח|ביי|להתראות|נתראה|good ?night|good ?bye|bye|see ya|see you)[\s!.…]*$/i

const HOLD_PHRASE_RE =
  /^(?:שנייה|שניה|רגע|רגע אחד|שנייה אחת|תן לי רגע|תני לי רגע|תנו לי רגע|חכה רגע|חכי רגע|one sec(?:ond)?|hold on|give me a (?:sec(?:ond)?|minute|min))[\s!.…]*$/i

/**
 * Purely social traffic that carries no request: thanks, a sign-off, a deferral,
 * or "hold on".
 *
 * This is the SHORT, POSITIVE silence list that replaced a catch-all. The gate
 * used to end in `NO_MEANINGFUL_INTENT`, which silenced social residue and
 * genuine first messages alike — "לילה טוב" and "אני צריך תור" met exactly the
 * same fate. Naming the residue is what makes it safe to answer everything else.
 */
export function isSocialResidue(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  if (isClosingAcknowledgement(t)) return true
  if (isConversationDeferral(t)) return true
  return SIGN_OFF_RE.test(t) || HOLD_PHRASE_RE.test(t)
}

/**
 * Read one inbound message as a turn in a conversation the agent owns.
 *
 * Call ONLY when the agent has already spoken here. On a thread it has not
 * spoken in there is no context to read the message against, and the opening
 * gate — which asks whether a stranger's first words merit a reply at all —
 * is the right question instead.
 */
export function decideEngagedTurn(f: EngagedTurnFacts): EngagedTurnDecision {
  const text = f.inboundText ?? ''

  // Nothing was said. True whether or not a question is open: an emoji is not
  // an answer, and replying to one produces a reply about nothing. Digits are
  // content here — see saysNothing.
  if (saysNothing(text)) return silent('LOW_INFORMATION')

  // "רגע" / "one sec" is an explicit request to wait. Honour it — the message
  // they are typing is the one worth answering.
  if (isHoldOnUtterance(text)) return silent('HOLD_ON')

  // A question outranks every silence rule below it. "היי אחי מה קורה?" is a
  // greeting AND a question, and reading it as a repeated greeting is how the
  // agent ends up ignoring someone who just asked it something.
  if (f.containsRealQuestion) return answer('REAL_QUESTION')

  if (f.agentAwaitingAnswer) {
    // A short affirmative answers a question by definition.
    if (isShortAffirmative(text)) return answer('ANSWERS_OPEN_QUESTION')
    // "תודה" to an open question is a polite exit, not an answer.
    if (isClosingAcknowledgement(text)) return silent('CLOSING_ACKNOWLEDGEMENT')
    // Everything else is the answer. This is the whole point of the file: no
    // further test is applied, because any further test would be the whitelist
    // again, and the whitelist is what dropped nine answers in ten.
    return answer('ANSWERS_OPEN_QUESTION')
  }

  // ── No question outstanding. The bar is slightly higher. ───────────────────

  // Repeating themselves verbatim adds nothing to reply to. Deliberately NOT
  // applied above: a customer may legitimately answer two different questions
  // with the same word.
  const now = normalize(text)
  const prev = f.previousCustomerText ? normalize(f.previousCustomerText) : ''
  if (now && prev && now === prev) return silent('NO_NEW_CONTENT')

  if (f.isGreetingOnly) return silent('GREETING_REPEAT')
  if (isClosingAcknowledgement(text)) return silent('CLOSING_ACKNOWLEDGEMENT')
  if (isConversationDeferral(text)) return silent('DEFERRAL')

  // "כן" with nothing outstanding to say yes to. The product rule is that a
  // short reply is understood IN RELATION TO THE PRECEDING QUESTION; with no
  // question there is no relation, and a reply here would be the agent talking
  // to itself.
  if (isShortAffirmative(text)) return silent('SHORT_AFFIRMATIVE')

  return answer('ENGAGED_CONTENT')
}
