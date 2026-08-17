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

const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /פגיש|להיפגש|זום|שיחה/,
  /נציג|לדבר עם|בנאדם|אדם אמיתי|שיחזרו? אלי|תתקשרו|תחזרו אלי/,
  /\bmeeting|schedule a (call|meeting)|book a\b/i,
  /talk to (a|someone)|speak (to|with)|call me|representative|\bagent\b|\bhuman\b/i,
]

const BUYING_INTENT_PATTERNS: RegExp[] = [
  /מחיר|תמחור|הצעת מחיר|עלות|בכמה|כמה.{0,12}עול/,
  /דמו|הדגמה/,
  /איך מתחיל|להתחיל|להזמין|לקנות|להצטרף/,
  /\bprice|pricing|cost|quote\b/i,
  /\bdemo\b/i,
  /how (do|can) i (start|begin|buy)|get started|sign ?up/i,
]

const HOT_PATTERNS: RegExp[] = [...HUMAN_REQUEST_PATTERNS, ...BUYING_INTENT_PATTERNS]

export function detectHotSignal(text: string): boolean {
  return HOT_PATTERNS.some((re) => re.test(text))
}

export function detectHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((re) => re.test(text))
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
  'thanks',
  'thank you',
  'thanks a lot',
  'ok',
  'okay',
  'got it',
])

function normalizeUtterance(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?!.,;:־]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCasualAcknowledgement(text: string): boolean {
  const n = normalizeUtterance(text)
  if (!n) return false
  if (CASUAL_EXACT.has(n)) return true
  return /^(thanks|thank you|תודה)( רבה| לך| a lot)?$/.test(n)
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
  if (detectHumanRequest(t)) return 'HANDOFF_REQUEST'
  if (detectHotSignal(t)) return 'BUYING_SIGNAL'
  if (isProductQuestion(t) || isExplanationRequest(t)) return 'PRODUCT_QUESTION'
  if (isProductFit(t) || isOrganizeLeadsIntent(t)) return 'PRODUCT_FIT'
  if (OBJECTION_RE.some((re) => re.test(t))) return 'OBJECTION'
  if (isNextStepAsk(t)) return 'BUYING_SIGNAL'

  const sticky = hasEstablishedProductIntent(opts)
  const offeredExplain = Boolean(opts?.previousOutbound && isExplanationOffer(opts.previousOutbound))

  if (offeredExplain && (isShortAffirmative(t) || isCasualAcknowledgement(t))) {
    return 'PRODUCT_QUESTION'
  }
  if (sticky && isShortAffirmative(t)) return 'PRODUCT_QUESTION'
  if (isCasualAcknowledgement(t)) {
    if (!sticky) return 'CASUAL_ACKNOWLEDGEMENT'
    return opts?.salesStrategy === 'explain' || opts?.salesStrategy === 'how_it_works'
      ? 'PRODUCT_QUESTION'
      : 'PRODUCT_FIT'
  }

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
