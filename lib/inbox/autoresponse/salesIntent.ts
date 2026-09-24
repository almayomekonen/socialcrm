/**
 * Deterministic sales-move classifier for IRE.
 * CRM fields never participate. Priority is the strategy source of truth.
 *
 * Human/buying detectors live here so qualify.ts can re-export them without a
 * circular import (qualify owns generation; this file owns intent).
 */
import { inboundStatesImpact, inboundStatesOutcome, inboundStatesPain } from './qualifyPrompt'
import { isProductStrategy, isSalesStrategy, type SalesStrategy } from './qualification'
import { isBusinessIdentityQuestion } from './businessIdentityIntent'

export type { SalesStrategy }
export { isProductStrategy, isSalesStrategy }
export { isBusinessIdentityQuestion }

export type HumanRequestOpts = {
  /** Previous assistant outbound. Echoing a product choice is not a meeting request. */
  previousOutbound?: string
}

/** Explicit ask for a person on our team. Wins even if the same line mentions שיחה. */
const EXPLICIT_PERSON_PATTERNS: RegExp[] = [
  /תעביר(?:י)? אותי/,
  /תחבר(?:י)? אותי/,
  /לדבר עם\s+(?:ה?נציג|מישהו|בן אדם|בנאדם|אדם(?: אמיתי)?)/,
  /אפשר לדבר/,
  /בן אדם|בנאדם|אדם אמיתי/,
  /נציג/,
  /שיחזרו? אלי/,
  /תתקשרו/,
  /תחזרו אלי/,
  /talk to (a|someone)|speak (to|with)|call me|representative|\bagent\b|\bhuman\b/i,
]

/**
 * Schedule a call/meeting with us. Includes שיחה only in meeting compounds —
 * never the bare token, so product talk about continuing conversations is not a handoff.
 */
const MEETING_SCHEDULE_PATTERNS: RegExp[] = [
  /פגיש|להיפגש/,
  /זום/,
  /\bmeeting\b/i,
  /schedule a (call|meeting)|book a\b/i,
  /(?:רוצה|אפשר|נקבע|לקבוע|לתאם)\s+שיחה/,
  /שיחה אית(?:ך|כם|כן)/,
]

const CONV_TOKEN = /שיח(?:ה|ות)?/
const CUSTOMER_PARTY = /הלקוח|הלקוחות|לקוחות(?:י)?/
const CONTINUE_CONV = /ימשיך|תמשיך|ממשיך|להמשיך|המשך/
const PRODUCT_CONV_OUTBOUND = /ימשיך את השיחה|השיחה עם הלקוח|מענה אוטומטי|ישיב מיד/

/** Product capability: the system continues WhatsApp conversations with THEIR customers. */
function isProductConversationCapability(text: string, previousOutbound?: string): boolean {
  const t = (text ?? '').trim()
  const prev = (previousOutbound ?? '').trim()
  if (!t) return false
  if (CONV_TOKEN.test(t) && CUSTOMER_PARTY.test(t)) return true
  if (CONV_TOKEN.test(t) && CONTINUE_CONV.test(t)) return true
  if (CONTINUE_CONV.test(t) && CUSTOMER_PARTY.test(t)) return true
  if (/ניהול שיח/.test(t)) return true
  if (/מענה אוטומטי/.test(t) && (CONV_TOKEN.test(t) || CONTINUE_CONV.test(t))) return true
  if (/(?:מערכת|בוט)/.test(t) && (CONV_TOKEN.test(t) || CONTINUE_CONV.test(t))) return true
  if (/תענה/.test(t) && CONV_TOKEN.test(t)) return true
  if (prev && PRODUCT_CONV_OUTBOUND.test(prev) && (CONV_TOKEN.test(t) || CONTINUE_CONV.test(t))) {
    return true
  }
  return false
}

const BUYING_INTENT_PATTERNS: RegExp[] = [
  /מחיר|תמחור|הצעת מחיר|עלות|בכמה|כמה.{0,12}עול/,
  /דמו|הדגמה/,
  /איך מתחיל|להתחיל|להזמין|לקנות|להצטרף/,
  /\bprice|pricing|cost|quote\b/i,
  /\bdemo\b/i,
  /how (do|can) i (start|begin|buy)|get started|sign ?up/i,
]

/**
 * ONLY the explicit ask for a person, without the meeting vocabulary.
 *
 * The questionnaire needs this narrower question. `detectHumanRequest` also
 * treats "פגישה" and "לקבוע שיחה" as a handoff, which is right for a sales
 * agent and wrong inside a script whose own questions invite answers like
 * "פגישה עסקית" — that answer would hand the conversation to a rep instead of
 * being recorded. Meeting talk is sales intent; this is a request for a person.
 */
export function isExplicitPersonRequest(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return EXPLICIT_PERSON_PATTERNS.some((re) => re.test(t))
}

export function detectHumanRequest(text: string, opts?: HumanRequestOpts): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (EXPLICIT_PERSON_PATTERNS.some((re) => re.test(t))) return true
  if (isProductConversationCapability(t, opts?.previousOutbound)) return false
  return MEETING_SCHEDULE_PATTERNS.some((re) => re.test(t))
}

export function detectHotSignal(text: string, opts?: HumanRequestOpts): boolean {
  if (detectHumanRequest(text, opts)) return true
  const t = text ?? ''
  const prepared = prepareUtteranceForClassify(t)
  return BUYING_INTENT_PATTERNS.some((re) => re.test(t) || re.test(prepared))
}

export const SALES_MOVES = [
  'HANDOFF_REQUEST',
  'BUYING_SIGNAL',
  'PRODUCT_QUESTION',
  'PRODUCT_FIT',
  'OBJECTION',
  'CASUAL_ACKNOWLEDGEMENT',
  'DEEPEN',
  'DISCOVERY',
] as const
export type SalesMove = (typeof SALES_MOVES)[number]

export function isSalesMove(v: unknown): v is SalesMove {
  return typeof v === 'string' && (SALES_MOVES as readonly string[]).includes(v)
}

const PRODUCT_QUESTION_RE: RegExp[] = [
  /האם\s+(אתם|המערכת|יש)/,
  /האם\s+ניתן/,
  /האם\s+אפשר/,
  /יש לכם/,
  /אתם עושים/,
  /המערכת\s+(יודעת|עושה|יכולה|מציעה|עובדת)/,
  /כיצד/,
  /איך זה עובד/,
  /איך המערכת/,
  /איך (אתה|אתם) יכול/,
  /מה המערכת עושה/,
  /מה המערכת מציעה/,
  /מה אפשר לעשות/,
  /אפשר לעשות/,
  /אפשר\s+לחבר/,
  /אפשר\s+להתחבר/,
  /ניתן\s+לחבר/,
  /ניתן\s+להתחבר/,
  /יש חיבור ל/,
  /תומך ב/,
  /עובד עם/,
  /מתחבר ל/,
  /מה המחיר/,
  /כמה עולה/,
  /יודעת לענות/,
  /עושה את זה/,
  /תגיב לו/,
  /לא ליד המסך/,
  /לא ליד/,
  /do you (have|do|offer|support)/i,
  /does (it|the system|your system)/i,
  /can (you|it|the system)\b/i,
  /how (can|could) you help/i,
  /how does it work/i,
  /is this possible/i,
]

const PRODUCT_FIT_RE: RegExp[] = [
  /זה מתאים/,
  /לעסק שלי/,
  /בשבילי/,
  /מערכת לניהול/,
  /עזרה בניהול לידים/,
  /(?:צרי[ךכ]|מחפש[ת]?|רוצה).{0,32}(?:מערכת|crm)/i,
  /for my (business|company)/i,
  /does it fit/i,
]

const OBJECTION_RE: RegExp[] = [
  /יקר|מסובך|כבר יש לי|לא בטוח|לא מתאים לי/,
  /too (expensive|complicated|complex)|already have|not sure/i,
]

const CASUAL_EXACT = new Set([
  'תודה',
  'תודה רבה',
  'תודה לך',
  'אוקיי',
  'אוקי',
  'סבבה',
  'הבנתי',
  'קיבלתי',
  'מעולה',
  'מצוין',
  'יופי',
  'בסדר',
  'נהדר',
  'thanks',
  'thank you',
  'thanks a lot',
  'ok',
  'okay',
  'got it',
  'great',
  'perfect',
  'cool',
])

/**
 * Collapse consecutive identical letters/marks to one.
 * "סבבההה" and "סבבה" share a token key; "מחיררר" → "מחיר".
 * Punctuation is left intact.
 */
export function collapseRepeatedLetters(text: string): string {
  return (text ?? '').replace(/([\p{L}\p{M}])\1+/gu, '$1')
}

/** Drop emoji / ZWJ so "😂😂 תודה" classifies as "תודה". Words stay. */
export function stripClassificationEmoji(text: string): string {
  return (text ?? '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\uFE0F\u200D\u20E3]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercase + strip emoji. Used before token splits. */
export function lightNormalizeUtterance(text: string): string {
  return stripClassificationEmoji(text)
    .toLowerCase()
    .replace(/[?!.,;:־…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Letter-collapsed form for regex / exact-set lookup. */
export function prepareUtteranceForClassify(text: string): string {
  return collapseRepeatedLetters(stripClassificationEmoji(text ?? ''))
}

function normalizeUtterance(text: string): string {
  return collapseRepeatedLetters(lightNormalizeUtterance(text))
}

function canonToken(tok: string): string {
  return collapseRepeatedLetters((tok ?? '').toLowerCase())
}

/** Vocative / colloquial filler around an acknowledgement. Not content. */
const ACK_FILLER_TOKENS = new Set([
  'אחי',
  'אח',
  'גבר',
  'אלוף',
  'מלך',
  'יא',
  'חבר',
  'יקר',
  'bro',
  'man',
  'dude',
])

/** Tokens that may appear in an acknowledgement-only utterance. */
const ACK_CONTENT_TOKENS = new Set([
  'תודה',
  'רבה',
  'לך',
  'thanks',
  'thank',
  'you',
  'lot',
  'ok',
  'okay',
  'אוקיי',
  'אוקי',
  'סבבה',
  'הבנתי',
  'קיבלתי',
  'מעולה',
  'מצוין',
  'יופי',
  'בסדר',
  'נהדר',
  'got',
  'it',
  'great',
  'perfect',
  'cool',
  'a',
])

const THANKS_PREP_TOKENS = new Set(['על', 'for', 'the'])
const THANKS_OBJECT_TOKENS = new Set([
  'ההסבר',
  'העזרה',
  'המידע',
  'התשובה',
  'הפירוט',
  'explanation',
  'help',
  'info',
  'information',
  'answer',
  'details',
])

function tokenIn(set: Set<string>, tok: string): boolean {
  const key = canonToken(tok.replace(/^ו/, ''))
  if (set.has(tok.replace(/^ו/, '')) || set.has(key)) return true
  for (const item of set) {
    if (canonToken(item) === key) return true
  }
  return false
}

/**
 * True only when the entire inbound is an acknowledgement (plus harmless filler).
 * "תודה אחי" / "סבבה תודה אחי" close. "תודה, ויש גם חיבור?" does not.
 */
export function isCasualAcknowledgement(text: string): boolean {
  const n = lightNormalizeUtterance(text)
  if (!n) return false
  const collapsed = collapseRepeatedLetters(n)
  if (CASUAL_EXACT.has(n) || CASUAL_EXACT.has(collapsed) || tokenIn(CASUAL_EXACT, collapsed)) return true
  const tokens = n
    .split(' ')
    .map((tok) => tok.replace(/^ו/, ''))
    .filter(Boolean)
  if (!tokens.length) return false
  let sawAck = false
  for (const tok of tokens) {
    if (tokenIn(ACK_FILLER_TOKENS, tok)) continue
    if (tokenIn(ACK_CONTENT_TOKENS, tok)) {
      sawAck = true
      continue
    }
    if (sawAck && tokenIn(THANKS_PREP_TOKENS, tok)) continue
    if (sawAck && tokenIn(THANKS_OBJECT_TOKENS, tok)) continue
    return false
  }
  return sawAck
}

/**
 * Whole-utterance goodbye / "we'll talk later" / well-wish.
 * True only when every token is a closing signal or harmless filler — never
 * because "נדבר" or "ביי" merely appears next to a real question.
 */
const DEAD_END_SIGNAL_TOKENS = new Set(['ביי', 'bye', 'goodbye', 'להתראות', 'נדבר', 'נשתמע'])

const DEAD_END_FILLER_TOKENS = new Set([
  'יאללה',
  'בהמשך',
  'על',
  'זה',
  'later',
  'soon',
  'כן',
  'yes',
  'אז',
  'אחר',
  'כך',
  'have',
  'good',
  'nice',
  'day',
  'talk',
  'to',
  'you',
  'take',
  'care',
])

const DEAD_END_EXACT = new Set([
  'נשתמע',
  'נשתמע בהמשך',
  'תישאר בקשר',
  'have a good day',
  'have a nice day',
  'talk later',
  'talk to you later',
  'take care',
])

function consumeDeadEndPhrase(tokens: string[], i: number): number | null {
  const a = canonToken(tokens[i] ?? '')
  const b = canonToken(tokens[i + 1] ?? '')
  const c = canonToken(tokens[i + 2] ?? '')
  const d = canonToken(tokens[i + 3] ?? '')
  if (a === canonToken('יום') && b === canonToken('טוב')) return 2
  if (a === 'see' && b === 'you') return 2
  if (a === canonToken('תישאר') && b === canonToken('בקשר')) return 2
  if (a === 'have' && b === 'a' && (c === 'good' || c === 'nice') && d === 'day') return 4
  if (a === 'talk' && b === 'to' && c === 'you' && d === 'later') return 4
  if (a === 'talk' && b === 'later') return 2
  if (a === 'take' && b === 'care') return 2
  return null
}

export function isDeadEndUtterance(text: string): boolean {
  const n = lightNormalizeUtterance(text)
  if (!n) return false
  const collapsed = collapseRepeatedLetters(n)
  if (DEAD_END_EXACT.has(n) || DEAD_END_EXACT.has(collapsed)) return true
  const tokens = n
    .split(' ')
    .map((tok) => tok.replace(/^ו/, ''))
    .filter(Boolean)
  if (!tokens.length) return false
  let sawSignal = false
  for (let i = 0; i < tokens.length; ) {
    const consumed = consumeDeadEndPhrase(tokens, i)
    if (consumed) {
      sawSignal = true
      i += consumed
      continue
    }
    const tok = tokens[i]
    if (tokenIn(DEAD_END_SIGNAL_TOKENS, tok)) {
      sawSignal = true
      i += 1
      continue
    }
    if (
      tokenIn(ACK_FILLER_TOKENS, tok) ||
      tokenIn(ACK_CONTENT_TOKENS, tok) ||
      tokenIn(DEAD_END_FILLER_TOKENS, tok) ||
      tokenIn(THANKS_PREP_TOKENS, tok)
    ) {
      i += 1
      continue
    }
    return false
  }
  return sawSignal
}

const HOLD_SIGNAL_TOKENS = new Set(['רגע', 'wait'])
const HOLD_FILLER_TOKENS = new Set(['שנייה', 'שניה', 'sec', 'second', 'one'])

/** Whole-utterance "hold on" — not a close, not a sales turn. */
export function isHoldOnUtterance(text: string): boolean {
  const n = lightNormalizeUtterance(text)
  if (!n) return false
  const tokens = n
    .split(' ')
    .map((tok) => tok.replace(/^ו/, ''))
    .filter(Boolean)
  if (!tokens.length) return false
  let sawHold = false
  for (const tok of tokens) {
    if (tokenIn(HOLD_SIGNAL_TOKENS, tok)) {
      sawHold = true
      continue
    }
    if (tokenIn(HOLD_FILLER_TOKENS, tok) || tokenIn(ACK_FILLER_TOKENS, tok)) continue
    return false
  }
  return sawHold
}

const HELP_REQUEST_RE =
  /יש לי (?:עוד )?שאלה|יש לי עוד משהו לשאול|רציתי לשאול|רציתי לדעת|לא הבנתי|לא מבין|לא מבינה|לא ברור(?: לי)?|אני צרי[ךכ]ה?\s+עזרה|תעזר[יי]? לי|תעזור לי|i have (?:another )?question|another question|i (?:don['’]?t|didn['’]?t) understand|i need help|can you help me/i

export function isExplicitHelpRequest(text: string): boolean {
  const t = prepareUtteranceForClassify(text)
  return HELP_REQUEST_RE.test(text ?? '') || HELP_REQUEST_RE.test(t)
}

/**
 * A polite REQUEST for information — the most common way a real lead asks to be
 * told more, and the one shape the intent gate did not recognise.
 *
 * Production conversation 6694 stopped dead here: the agent greeted and asked
 * "מה רצית לדעת על המערכת?", the customer answered
 * "היי אשמח לקבל פרטים על המערכת שלכם", and the turn was skipped as
 * `NO_MEANINGFUL_INTENT`. Every existing predicate missed it, because the
 * sentence is not interrogative: no question mark, no question word, no stated
 * pain, no explicit "I need help". It is a request, and a request was intent
 * nobody had encoded.
 *
 * Deliberately requires BOTH a request verb and an information object, so
 * "אשמח לקבל" alone (happy to receive… what?) and a bare "פרטים" do not qualify.
 */
const INFORMATION_OBJECT =
  '(?:פרטים|מידע|הצעת מחיר|הצעה|פירוט|הסבר|מחירון|קטלוג|לשמוע עוד|לדעת עוד|לשמוע על|לדעת על)'

const INFORMATION_REQUEST_RE = new RegExp(
  [
    // Hebrew: <request verb> … <information object>
    '(?:אשמח|ישמח לי|אפשר|איך אפשר|רוצה|רוצי|מעוניי[נן]|מעוניינת|מחפש|מחפשת|תוכל|תוכלי|אפשרי)' +
      '[^.!?\n]{0,40}' +
      INFORMATION_OBJECT,
    // Hebrew imperative: "send me …". The object is required here too. Without
    // it, "אל תשלחו לי הודעות" — stop messaging me — read as a request for
    // information and spent a model call on an opt-out.
    '(?:תשלח|תשלחי|תשלחו|שלח לי|שלחי לי|שלחו לי)' + '[^.!?\n]{0,40}' + INFORMATION_OBJECT,
    // Hebrew: "tell me about X" — the object is built into the phrase.
    '(?:ספר לי על|ספרי לי על|ספרו לי על|תספר לי על|תספרי לי על|תספרו לי על)',
    // English
    "\\b(?:i(?:'d| would) like|can i get|could i get|i want|i need|interested in|looking for)\\b[^.!?\\n]{0,40}\\b(?:details?|info(?:rmation)?|pricing|a quote|more)\\b",
    '\\b(?:send|tell) me (?:more|about|the details?|some info)',
    '\\btell me about\\b',
  ].join('|'),
  'i',
)

/**
 * A refusal wears the same verbs as a request. "אל תשלחו לי", "לא מעוניין",
 * "don't send me" must never reach the request branch — an opt-out that costs a
 * model call is a defect even though the opt-out itself is honoured upstream by
 * decidePreGeneration.
 */
const NEGATED_REQUEST_RE =
  /(?:^|\s)(?:אל|לא)\s+(?:תשלח|תשלחי|תשלחו|תספר|תספרי|תספרו|רוצה|רוצים|מעוניין|מעוניינת|מעוניינים)|\b(?:do\s?n[o']?t|do not|please stop|stop)\s+(?:send|sending|tell|telling|contact|contacting|messag)/i

/**
 * True when the customer asked to be told something, without phrasing it as a
 * question. Intent, not interrogation.
 */
export function isInformationRequest(text: string): boolean {
  const raw = text ?? ''
  const prepared = prepareUtteranceForClassify(raw)
  if (NEGATED_REQUEST_RE.test(raw) || NEGATED_REQUEST_RE.test(prepared)) return false
  return INFORMATION_REQUEST_RE.test(raw) || INFORMATION_REQUEST_RE.test(prepared)
}

/** Frustration about losing leads/customers. Not opt-out. Bare "נמאס לי" is not enough. */
export function isBusinessPainSignal(text: string): boolean {
  const raw = text ?? ''
  const prepared = prepareUtteranceForClassify(raw)
  const hasLead = /ליד|לקוח|\bleads?\b|\bclients?\b/i.test(raw) || /ליד|לקוח|\bleads?\b|\bclients?\b/i.test(prepared)
  if (!hasLead) return false
  const pain = /נמאס|מתוסכל|משגע|מאבד|לאבד|losing|\blose\b|\blost\b|frustrated|sick of/i
  return pain.test(raw) || pain.test(prepared) || inboundStatesPain(raw)
}

/** Pending question the customer can answer: last sentence is interrogative, or an explain-offer. */
export function outboundAsksQuestion(text?: string | null): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (isExplanationOffer(t)) return true
  const sentences = t
    .split(/(?<=[.!?؟\n])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
  const last = sentences[sentences.length - 1] ?? t
  return /[?؟]\s*$/.test(last)
}

export function isProductQuestion(text: string): boolean {
  const prepared = prepareUtteranceForClassify(text)
  return [text ?? '', prepared].some(
    (t) => PRODUCT_QUESTION_RE.some((re) => re.test(t)) || isBusinessIdentityQuestion(t),
  )
}

export function isProductFit(text: string): boolean {
  const prepared = prepareUtteranceForClassify(text)
  return PRODUCT_FIT_RE.some((re) => re.test(text ?? '') || re.test(prepared))
}

const EXPLAIN_REQUEST_RE =
  /תן לי הסבר|הסבר קצר|תסביר(?:י)?(?:\s+לי)?|explain (?:the )?(?:system|product)|how does (?:the )?(?:system|product) work/i
const ORGANIZE_LEADS_RE = /תסדר.{0,16}ליד|לסדר.{0,16}ליד|תארגן.{0,16}ליד/i
const NEXT_STEP_RE =
  /איך (?:אנחנו )?מתקדמ|מה עכשיו|איך ממשיכ|\bwhat(?:['’]?s| is) next\b|how (?:do we|to) (?:proceed|continue)/i
const EXPLAIN_OFFER_RE = /רוצה שאסביר|אשביר|להסביר|איך זה נראה|want me to explain|shall i explain/i
const AFFIRM_EXACT = new Set([
  'כן',
  'כן תסביר',
  'כן בבקשה',
  'בטח',
  'יאללה',
  'אוקיי',
  'אוקי',
  'ok',
  'okay',
  'yes',
  'sure',
  'yep',
])

export function isExplanationRequest(text: string): boolean {
  return EXPLAIN_REQUEST_RE.test(text)
}

export function isOrganizeLeadsIntent(text: string): boolean {
  return ORGANIZE_LEADS_RE.test(text)
}

export function isNextStepAsk(text: string): boolean {
  const raw = text ?? ''
  const prepared = prepareUtteranceForClassify(raw)
  return NEXT_STEP_RE.test(raw) || NEXT_STEP_RE.test(prepared)
}

export function isExplanationOffer(text: string): boolean {
  return EXPLAIN_OFFER_RE.test((text ?? '').trim())
}

export function isShortAffirmative(text: string): boolean {
  const n = lightNormalizeUtterance(text)
  if (!n) return false
  const collapsed = collapseRepeatedLetters(n)
  if (AFFIRM_EXACT.has(n) || AFFIRM_EXACT.has(collapsed)) return true
  return tokenIn(AFFIRM_EXACT, n) || tokenIn(AFFIRM_EXACT, collapsed)
}

export type ClassifySalesOpts = {
  priorMoves?: readonly SalesMove[]
  previousOutbound?: string
  salesStrategy?: SalesStrategy
}

function hasEstablishedProductIntent(opts?: ClassifySalesOpts): boolean {
  if (isProductStrategy(opts?.salesStrategy)) return true
  return (opts?.priorMoves ?? []).some((m) => m === 'PRODUCT_FIT' || m === 'PRODUCT_QUESTION')
}

/** Product / explain / next-step moves: zero questions allowed, PK eligible, product fallback. */
export function salesMoveUsesProductContract(move: SalesMove | null | undefined): boolean {
  return move === 'PRODUCT_QUESTION' || move === 'PRODUCT_FIT' || move === 'BUYING_SIGNAL'
}

/**
 * Classify the current inbound. Explicit last-inbound intents still win.
 * Short/ambiguous replies also consider previousOutbound + sticky product strategy.
 * Qualification / missing CRM fields are ignored on purpose.
 */
export function classifySalesMove(text: string, opts?: ClassifySalesOpts): SalesMove {
  const t = (text ?? '').trim()
  if (!t) return 'DISCOVERY'
  if (detectHumanRequest(t, { previousOutbound: opts?.previousOutbound })) return 'HANDOFF_REQUEST'
  if (detectHotSignal(t, { previousOutbound: opts?.previousOutbound })) return 'BUYING_SIGNAL'
  if (isProductQuestion(t) || isExplanationRequest(t) || isProductConversationCapability(t, opts?.previousOutbound)) {
    return 'PRODUCT_QUESTION'
  }
  if (isProductFit(t) || isOrganizeLeadsIntent(t)) return 'PRODUCT_FIT'
  if (OBJECTION_RE.some((re) => re.test(t))) return 'OBJECTION'
  if (isNextStepAsk(t)) return 'BUYING_SIGNAL'

  const sticky = hasEstablishedProductIntent(opts)
  const askedQuestion = outboundAsksQuestion(opts?.previousOutbound)

  if (isHoldOnUtterance(t)) return 'DISCOVERY'

  // Affirm / ack after an actual question continues. Thanks/ok after an answer do not.
  // Whole-utterance dead-ends (יאללה ביי / נדבר / יום טוב) still close even after a question.
  if (askedQuestion && (isShortAffirmative(t) || isCasualAcknowledgement(t)) && !isDeadEndUtterance(t)) {
    return 'PRODUCT_QUESTION'
  }
  if (isCasualAcknowledgement(t) || isDeadEndUtterance(t)) return 'CASUAL_ACKNOWLEDGEMENT'
  if (sticky && isShortAffirmative(t)) return 'PRODUCT_QUESTION'

  const deepen = inboundStatesPain(t) || inboundStatesImpact(t) || inboundStatesOutcome(t)
  if (deepen) {
    const prior = opts?.priorMoves ?? []
    if (sticky || prior.some((m) => m === 'PRODUCT_FIT' || m === 'PRODUCT_QUESTION')) return 'PRODUCT_FIT'
    return 'DEEPEN'
  }

  if (sticky) {
    if (opts?.salesStrategy === 'explain' || opts?.salesStrategy === 'how_it_works') return 'PRODUCT_QUESTION'
    return 'PRODUCT_FIT'
  }
  return 'DISCOVERY'
}

export function nextSalesStrategy(args: {
  salesMove: SalesMove
  previous?: SalesStrategy
  lastInbound: string
  previousOutbound?: string
}): SalesStrategy {
  const { salesMove, previous, lastInbound, previousOutbound } = args
  if (salesMove === 'HANDOFF_REQUEST') return 'discover'
  if (salesMove === 'OBJECTION') return 'discover'
  if (salesMove === 'PRODUCT_QUESTION') {
    if (
      isExplanationRequest(lastInbound) ||
      (previousOutbound && isExplanationOffer(previousOutbound) && isShortAffirmative(lastInbound))
    ) {
      return 'explain'
    }
    return 'how_it_works'
  }
  if (salesMove === 'PRODUCT_FIT') return 'product_fit'
  if (salesMove === 'BUYING_SIGNAL') return 'next_step'
  if (previous && isSalesStrategy(previous) && isProductStrategy(previous)) return previous
  return 'discover'
}

export function classifySalesTurn(args: {
  lastInbound: string
  previousOutbound?: string
  priorMoves?: readonly SalesMove[]
  salesStrategy?: SalesStrategy
}): { salesMove: SalesMove; salesStrategy: SalesStrategy } {
  const salesMove = classifySalesMove(args.lastInbound, {
    priorMoves: args.priorMoves,
    previousOutbound: args.previousOutbound,
    salesStrategy: args.salesStrategy,
  })
  return {
    salesMove,
    salesStrategy: nextSalesStrategy({
      salesMove,
      previous: args.salesStrategy,
      lastInbound: args.lastInbound,
      previousOutbound: args.previousOutbound,
    }),
  }
}

function lastOutboundBeforeFinalInbound(
  transcript: Array<{ direction: string; text: string }>,
): string | undefined {
  let seenInbound = false
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i]
    if (!m) continue
    if (!seenInbound && m.direction === 'inbound' && (m.text ?? '').trim()) {
      seenInbound = true
      continue
    }
    if (seenInbound && m.direction === 'outbound' && (m.text ?? '').trim()) return m.text
  }
  return undefined
}

/** Last inbound wins; short replies use previous outbound + sticky product strategy. */
export function classifySalesTurnFromTranscript(
  transcript: Array<{ direction: string; text: string }>,
  opts?: { salesStrategy?: SalesStrategy },
): { salesMove: SalesMove; salesStrategy: SalesStrategy } {
  const inbounds = transcript.filter((m) => m.direction === 'inbound' && (m.text ?? '').trim())
  const last = inbounds[inbounds.length - 1]
  if (!last) return { salesMove: 'DISCOVERY', salesStrategy: opts?.salesStrategy ?? 'discover' }
  const priorMoves = inbounds.slice(0, -1).map((m) => classifySalesMove(m.text))
  return classifySalesTurn({
    lastInbound: last.text,
    previousOutbound: lastOutboundBeforeFinalInbound(transcript),
    priorMoves,
    salesStrategy: opts?.salesStrategy,
  })
}

export function classifySalesMoveFromTranscript(
  transcript: Array<{ direction: string; text: string }>,
  opts?: { salesStrategy?: SalesStrategy },
): SalesMove {
  return classifySalesTurnFromTranscript(transcript, opts).salesMove
}
