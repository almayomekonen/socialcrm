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

export function detectHumanRequest(text: string, opts?: HumanRequestOpts): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (EXPLICIT_PERSON_PATTERNS.some((re) => re.test(t))) return true
  if (isProductConversationCapability(t, opts?.previousOutbound)) return false
  return MEETING_SCHEDULE_PATTERNS.some((re) => re.test(t))
}

export function detectHotSignal(text: string, opts?: HumanRequestOpts): boolean {
  if (detectHumanRequest(text, opts)) return true
  return BUYING_INTENT_PATTERNS.some((re) => re.test(text ?? ''))
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
  /יש לכם/,
  /אתם עושים/,
  /המערכת\s+(יודעת|עושה|יכולה)/,
  /איך זה עובד/,
  /איך (אתה|אתם) יכול/,
  /מה המערכת עושה/,
  /אפשר לעשות/,
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

function normalizeUtterance(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?!.,;:־]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

/**
 * True only when the entire inbound is an acknowledgement (plus harmless filler).
 * "תודה אחי" / "סבבה תודה אחי" close. "תודה, ויש גם חיבור?" does not.
 */
export function isCasualAcknowledgement(text: string): boolean {
  const n = normalizeUtterance(text)
  if (!n) return false
  if (CASUAL_EXACT.has(n)) return true
  const tokens = n
    .split(' ')
    .map((tok) => tok.replace(/^ו/, ''))
    .filter(Boolean)
  if (!tokens.length) return false
  let sawAck = false
  for (const tok of tokens) {
    if (ACK_FILLER_TOKENS.has(tok)) continue
    if (ACK_CONTENT_TOKENS.has(tok)) {
      sawAck = true
      continue
    }
    return false
  }
  return sawAck
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
  return PRODUCT_QUESTION_RE.some((re) => re.test(text)) || isBusinessIdentityQuestion(text)
}

export function isProductFit(text: string): boolean {
  return PRODUCT_FIT_RE.some((re) => re.test(text))
}

const EXPLAIN_REQUEST_RE =
  /תן לי הסבר|הסבר קצר|תסביר(?:י)?(?:\s+לי)?|explain (?:the )?(?:system|product)|how does (?:the )?(?:system|product) work/i
const ORGANIZE_LEADS_RE = /תסדר.{0,16}ליד|לסדר.{0,16}ליד|תארגן.{0,16}ליד/i
const NEXT_STEP_RE =
  /איך (?:אנחנו )?מתקדמ|מה עכשיו|איך ממשיכ|what(?:'s| is) next|how (?:do we|to) (?:proceed|continue)/i
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
  return NEXT_STEP_RE.test(text)
}

export function isExplanationOffer(text: string): boolean {
  return EXPLAIN_OFFER_RE.test((text ?? '').trim())
}

export function isShortAffirmative(text: string): boolean {
  const n = normalizeUtterance(text)
  return Boolean(n) && AFFIRM_EXACT.has(n)
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

  // Affirm / ack after an actual question continues. Thanks/ok after an answer do not.
  if (askedQuestion && (isShortAffirmative(t) || isCasualAcknowledgement(t))) {
    return 'PRODUCT_QUESTION'
  }
  if (isCasualAcknowledgement(t)) return 'CASUAL_ACKNOWLEDGEMENT'
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
