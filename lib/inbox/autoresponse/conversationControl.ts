/**
 * Conversation control / stop policy. Pure and deterministic.
 * The LLM never decides whether a WhatsApp message may be sent.
 */
import type { AiState } from './qualification'
import {
  isCasualAcknowledgement,
  isDeadEndUtterance,
  isHoldOnUtterance,
  isExplicitHelpRequest,
  isBusinessPainSignal,
  isProductFit,
  isProductQuestion,
  outboundAsksQuestion,
  detectHumanRequest,
  detectHotSignal,
  collapseRepeatedLetters,
  stripClassificationEmoji,
  type SalesMove,
} from './salesIntent'

export { outboundAsksQuestion }

export const MAX_CONSECUTIVE_AI_WITHOUT_INBOUND = 1

export type CloseSend = 'silence' | 'closer'

export type ControlDecision =
  | { action: 'CONTINUE' }
  | { action: 'ASK_QUESTION' }
  | { action: 'CLOSE_CONVERSATION'; send: CloseSend; reason: string }
  | { action: 'HANDOFF_TO_HUMAN'; reason: string }

/** Persisted on markClosed when the customer confirms the no-response warning. */
export const NO_RESPONSE_CONFIRMED_REASON = 'no_response_confirmed'

const DECLINE_EXACT = new Set([
  'לא מעוניין',
  'לא מעוניינת',
  'לא מעניין',
  'לא תודה',
  'לא צריך',
  'לא רלוונטי',
  'not interested',
  'no thanks',
  'no thank you',
])

const GOODBYE_EXACT = new Set(['bye', 'goodbye', 'להתראות', 'ביי', 'bye bye', 'see you'])

function normalizeUtterance(text: string): string {
  return collapseRepeatedLetters(
    stripClassificationEmoji(text)
      .trim()
      .toLowerCase()
      .replace(/[?!.,;:־…]+/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function setHasNormalized(set: Set<string>, n: string): boolean {
  if (!n) return false
  if (set.has(n)) return true
  for (const item of set) {
    if (collapseRepeatedLetters(item) === n) return true
  }
  return false
}

function metaSource(metadata: unknown): string {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { source?: string } | null)?.source ?? ''
  } catch {
    return ''
  }
}

function metaKind(metadata: unknown): string {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { kind?: string } | null)?.kind ?? ''
  } catch {
    return ''
  }
}

/** English how-questions without requiring "?". Parity with Hebrew איך. */
const ENGLISH_HOW_QUESTION_RE = /\bhow (?:do|can|does|to)\b/i

/** True when this inbound contains a real question, even if it also says thanks. */
export function inboundContainsRealQuestion(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (/[?؟]/.test(t)) return true
  if (isProductQuestion(t)) return true
  if (ENGLISH_HOW_QUESTION_RE.test(t)) return true
  return /(?:^|\s)(?:האם|איך|כיצד|למה|כמה|can you|do you|is there)\b/i.test(t)
}

export function isConversationDecline(text: string): boolean {
  const n = normalizeUtterance(text)
  if (!n) return false
  if (setHasNormalized(DECLINE_EXACT, n)) return true
  return /^(?:לא מעוניין|לא מעוניינת|לא מעניין|not interested)\b/.test(n)
}

export function isConversationGoodbye(text: string): boolean {
  const n = normalizeUtterance(text)
  if (!n) return false
  if (setHasNormalized(GOODBYE_EXACT, n)) return true
  return /^(?:bye|goodbye|להתראות|ביי|בי)\b/.test(n)
}

/**
 * Whole-utterance confirmations of a close-offer. Never used globally —
 * decideConversationControl only consults this when the previous outbound is
 * the no-response warning. Contrast / a new question / "I'm here" are not close.
 */
const CLOSE_CONFIRM_EXACT = new Set([
  'כן',
  'כן תסגור',
  'כן תסגרי',
  'תסגור',
  'תסגרי',
  'סגור',
  'סגרי',
  'בטח',
  'אפשר לסגור',
  'תסגור את השיחה',
  'תסגרי את השיחה',
  'כן תסגור את השיחה',
  'בסדר תסגור',
  'כן בבקשה',
  'go ahead',
  'close it',
  'please close',
  'yes close',
  'yes',
  'sure',
])

const CLOSE_CONFIRM_VERBS = new Set(['תסגור', 'תסגרי', 'לסגור', 'סגור', 'סגרי', 'close'])

/** Harmless filler around a close verb. Never sufficient on their own. */
const CLOSE_CONFIRM_MODIFIERS = new Set([
  'כן',
  'yes',
  'sure',
  'בטח',
  'בבקשה',
  'אפשר',
  'את',
  'השיחה',
  'זה',
  'this',
  'that',
  'בסדר',
  'ok',
  'okay',
  'please',
  'go',
  'ahead',
  'it',
  'the',
  'conversation',
  'תודה',
  'thanks',
  'thank',
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

const CLOSE_OFFER_CONTRAST_RE = /אבל|לפני|אחרי\s+ש|\bbut\b|\bhowever\b|שאלה|לגבי/
const STAY_PRESENT_RE = /רגע|אני פה|אני כאן|still here|i['’]?m here|\bwait\b/i

export function isCloseOfferContext(args: {
  closeOfferPending?: boolean
  previousOutboundKind?: string
}): boolean {
  return args.closeOfferPending === true || args.previousOutboundKind === 'no_response_warning'
}

/** Conservative: false-positive CLOSE is worse than a missed close. */
export function isClearCloseConfirmation(text: string): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  if (inboundContainsRealQuestion(raw)) return false
  if (CLOSE_OFFER_CONTRAST_RE.test(raw)) return false
  if (STAY_PRESENT_RE.test(raw)) return false
  const n = normalizeUtterance(raw)
  if (!n) return false
  if (setHasNormalized(CLOSE_CONFIRM_EXACT, n)) return true
  const tokens = n.split(' ').filter(Boolean)
  if (!tokens.length) return false
  let sawVerb = false
  for (const tok of tokens) {
    if (setHasNormalized(CLOSE_CONFIRM_VERBS, tok)) {
      sawVerb = true
      continue
    }
    if (setHasNormalized(CLOSE_CONFIRM_MODIFIERS, tok)) continue
    return false
  }
  return sawVerb
}

const REOPEN_INDEPENDENT_MOVES = new Set<SalesMove>(['HANDOFF_REQUEST', 'BUYING_SIGNAL', 'OBJECTION', 'DEEPEN'])

/** Closed conversations reopen only on a real question, new need, or human request. Sticky PRODUCT_FIT is not enough. */
export function isExplicitReopen(args: { salesMove: SalesMove; inboundText: string }): boolean {
  const t = args.inboundText ?? ''
  if (isHoldOnUtterance(t) || isCasualAcknowledgement(t) || isDeadEndUtterance(t)) return false
  if (args.salesMove === 'HANDOFF_REQUEST' || detectHumanRequest(t)) return true
  if (inboundContainsRealQuestion(t)) return true
  if (isExplicitHelpRequest(t)) return true
  if (isBusinessPainSignal(t)) return true
  if (detectHotSignal(t)) return true
  if (isProductQuestion(t) || isProductFit(t)) return true
  return REOPEN_INDEPENDENT_MOVES.has(args.salesMove)
}

/** Trailing auto-response outbounds since the last inbound (or human outbound). */
export function countConsecutiveAiOutbounds(
  messages: Array<{ direction: string; metadata?: unknown }>,
): number {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.direction !== 'outbound') break
    const kind = metaKind(m.metadata)
    if (kind === 'no_response_warning' || kind === 'no_response_close') continue
    const src = metaSource(m.metadata)
    if (src && src !== 'auto_response') break
    n += 1
  }
  return n
}

export function allowsOutbound(f: {
  aiState: AiState
  hasUnansweredInbound: boolean
  consecutiveAiWithoutInbound: number
  humanTookOver: boolean
  optOut: boolean
  reopenEligible?: boolean
}): { allowed: true } | { allowed: false; reason: string } {
  if (f.humanTookOver) return { allowed: false, reason: 'human_active' }
  if (f.optOut) return { allowed: false, reason: 'opt_out' }
  if (f.aiState === 'human_active') return { allowed: false, reason: 'human_active' }
  if (f.aiState === 'opted_out') return { allowed: false, reason: 'opted_out' }
  if (f.aiState === 'escalated') return { allowed: false, reason: 'already_escalated' }
  if (f.aiState === 'closed' && !f.reopenEligible) return { allowed: false, reason: 'closed' }
  if (!f.hasUnansweredInbound) return { allowed: false, reason: 'no_pending_inbound' }
  if (f.consecutiveAiWithoutInbound >= MAX_CONSECUTIVE_AI_WITHOUT_INBOUND) {
    return { allowed: false, reason: 'consecutive_ai' }
  }
  return { allowed: true }
}

/**
 * Commercial stop/continue decision. Call after the classifier, before GPT.
 * Opt-out / human takeover / closed-state hard stops belong to decidePreGeneration.
 */
export function decideConversationControl(args: {
  salesMove: SalesMove
  inboundText: string
  previousOutbound?: string
  previousOutboundKind?: string
  closeOfferPending?: boolean
}): ControlDecision {
  if (args.salesMove === 'HANDOFF_REQUEST') return { action: 'HANDOFF_TO_HUMAN', reason: 'human_request' }
  if (isCloseOfferContext(args)) {
    if (inboundContainsRealQuestion(args.inboundText)) {
      return args.salesMove === 'DISCOVERY' || args.salesMove === 'DEEPEN'
        ? { action: 'ASK_QUESTION' }
        : { action: 'CONTINUE' }
    }
    if (isClearCloseConfirmation(args.inboundText)) {
      return { action: 'CLOSE_CONVERSATION', send: 'closer', reason: NO_RESPONSE_CONFIRMED_REASON }
    }
    if (isConversationDecline(args.inboundText)) {
      return { action: 'CLOSE_CONVERSATION', send: 'closer', reason: 'decline' }
    }
    if (isConversationGoodbye(args.inboundText)) {
      return { action: 'CLOSE_CONVERSATION', send: 'closer', reason: 'goodbye' }
    }
    if (isDeadEndUtterance(args.inboundText)) {
      return { action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'goodbye' }
    }
    return { action: 'CONTINUE' }
  }
  if (inboundContainsRealQuestion(args.inboundText)) {
    return args.salesMove === 'DISCOVERY' || args.salesMove === 'DEEPEN'
      ? { action: 'ASK_QUESTION' }
      : { action: 'CONTINUE' }
  }
  if (isConversationDecline(args.inboundText)) {
    return { action: 'CLOSE_CONVERSATION', send: 'closer', reason: 'decline' }
  }
  if (isConversationGoodbye(args.inboundText)) {
    return { action: 'CLOSE_CONVERSATION', send: 'closer', reason: 'goodbye' }
  }
  if (isDeadEndUtterance(args.inboundText)) {
    return { action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'goodbye' }
  }
  if (isCasualAcknowledgement(args.inboundText) && !outboundAsksQuestion(args.previousOutbound)) {
    return { action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' }
  }
  if (args.salesMove === 'CASUAL_ACKNOWLEDGEMENT') {
    return { action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' }
  }
  if (args.salesMove === 'DISCOVERY' || args.salesMove === 'DEEPEN') return { action: 'ASK_QUESTION' }
  return { action: 'CONTINUE' }
}

export function conversationCloser(lang: 'he' | 'en'): string {
  return lang === 'en' ? 'No problem, thanks.' : 'אין בעיה, תודה.'
}
