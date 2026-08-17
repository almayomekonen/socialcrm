/**
 * Deterministic sales-move classifier for IRE.
 * CRM fields never participate. Priority is the strategy source of truth.
 *
 * Human/buying detectors live here so qualify.ts can re-export them without a
 * circular import (qualify owns generation; this file owns intent).
 */
import { inboundStatesImpact, inboundStatesOutcome, inboundStatesPain } from './qualifyPrompt'

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
  return PRODUCT_QUESTION_RE.some((re) => re.test(text))
}

export function isProductFit(text: string): boolean {
  return PRODUCT_FIT_RE.some((re) => re.test(text))
}

/**
 * Classify the current inbound. Higher-priority matches win. Qualification /
 * missing CRM fields are ignored on purpose.
 */
export function classifySalesMove(
  text: string,
  opts?: { priorMoves?: readonly SalesMove[] },
): SalesMove {
  const t = (text ?? '').trim()
  if (!t) return 'DISCOVERY'
  if (detectHumanRequest(t)) return 'HANDOFF_REQUEST'
  if (detectHotSignal(t)) return 'BUYING_SIGNAL'
  if (isProductQuestion(t)) return 'PRODUCT_QUESTION'
  if (isProductFit(t)) return 'PRODUCT_FIT'
  if (OBJECTION_RE.some((re) => re.test(t))) return 'OBJECTION'
  if (isCasualAcknowledgement(t)) return 'CASUAL_ACKNOWLEDGEMENT'
  const deepen = inboundStatesPain(t) || inboundStatesImpact(t) || inboundStatesOutcome(t)
  if (deepen) {
    const prior = opts?.priorMoves ?? []
    if (prior.some((m) => m === 'PRODUCT_FIT' || m === 'PRODUCT_QUESTION')) return 'PRODUCT_FIT'
    return 'DEEPEN'
  }
  return 'DISCOVERY'
}

/** Last inbound wins; pain/impact restated after a product turn stays on product fit. */
export function classifySalesMoveFromTranscript(
  transcript: Array<{ direction: string; text: string }>,
): SalesMove {
  const inbounds = transcript.filter((m) => m.direction === 'inbound' && (m.text ?? '').trim())
  const last = inbounds[inbounds.length - 1]
  if (!last) return 'DISCOVERY'
  const priorMoves = inbounds.slice(0, -1).map((m) => classifySalesMove(m.text))
  return classifySalesMove(last.text, { priorMoves })
}
