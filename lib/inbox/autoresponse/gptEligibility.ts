/**
 * Deterministic GPT eligibility for IRE qualify turns.
 * Conversation Control owns CLOSE / HANDOFF. This gate only answers:
 * does this CONTINUE / ASK_QUESTION inbound need an AI-generated reply?
 * The LLM never decides whether the LLM should run.
 */
import {
  classifySalesMove,
  isBusinessPainSignal,
  isCasualAcknowledgement,
  isExplicitHelpRequest,
  isHoldOnUtterance,
  isShortAffirmative,
  outboundAsksQuestion,
  collapseRepeatedLetters,
  stripClassificationEmoji,
  type SalesMove,
} from './salesIntent'
import { inboundContainsRealQuestion } from './conversationControl'

export type GptEligibilityDecision = 'RUN_AI' | 'WAIT'

export type GptEligibilityReason =
  | 'LOW_INFORMATION'
  | 'ACKNOWLEDGEMENT'
  | 'NO_NEW_CONTENT'
  | 'GREETING_REPEAT'
  | 'SHORT_AFFIRMATIVE'
  | 'PENDING_QUESTION'
  | 'HOLD_ON'
  | 'STAY_PRESENT'
  | 'PAIN_SIGNAL'
  | 'REAL_QUESTION'
  | 'HELP'
  | 'FIRST_TURN'
  | 'PRODUCT_QUESTION'
  | 'PRODUCT_FIT'
  | 'BUYING_SIGNAL'
  | 'OBJECTION'
  | 'DEEPEN'
  | 'DISCOVERY'
  | 'NO_MEANINGFUL_INTENT'

export type GptEligibility = {
  decision: GptEligibilityDecision
  reason: GptEligibilityReason
}

export type GptEligibilityInput = {
  inboundText: string
  previousOutbound?: string
  previousOutboundKind?: string
  salesMove: SalesMove
  controlAction: 'CONTINUE' | 'ASK_QUESTION'
  customerInboundCount: number
  previousCustomerText?: string
}

const MEANINGFUL_MOVES = new Set<SalesMove>([
  'PRODUCT_QUESTION',
  'PRODUCT_FIT',
  'BUYING_SIGNAL',
  'OBJECTION',
  'DEEPEN',
])

/** Moves that count only when THIS inbound independently classifies as them. Sticky strategy does not count. */
const CURRENT_TEXT_INTENT_MOVES = new Set<SalesMove>([
  'HANDOFF_REQUEST',
  'BUYING_SIGNAL',
  'PRODUCT_QUESTION',
  'PRODUCT_FIT',
  'OBJECTION',
  'DEEPEN',
])

const GREETING_EXACT = new Set([
  'היי',
  'הי',
  'שלום',
  'hi',
  'hello',
  'hey',
  'yo',
  'מה קורה',
  'מה נשמע',
  'היי מה קורה',
  'היי מה נשמע',
])

/**
 * Task 13 — greeting compounds for the Contact first turn: a run of greeting
 * cores, each optionally followed by a vocative or a "מה קורה" style tail
 * ("היי שלום", "היי אחי", "היי אחי מה קורה").
 *
 * Recognising these as greetings is what lets an unknown Contact get answered on
 * turn one. It must never silence a real question — see the REAL_QUESTION escape
 * in the greeting branch of shouldInvokeSalesAi.
 */
const GREETING_CORE = new Set(['היי', 'הי', 'שלום', 'hi', 'hello', 'hey', 'yo'])
const GREETING_VOCATIVE = new Set(['אחי', 'אח', 'bro', 'dude', 'man'])
const GREETING_TAIL: Array<[string, string]> = [
  ['מה', 'קורה'],
  ['מה', 'נשמע'],
  ['whats', 'up'],
]

const HELP_RE =
  /לא הבנתי|לא מבין|לא מבינה|לא ברור(?: לי)?|אני צרי[ךכ]ה?\s+עזרה|תעזר[יי]? לי|תעזור לי|יש לי (?:עוד )?שאלה|רציתי לשאול|didn['’]?t understand|i (?:don['’]?t|didn['’]?t) understand|i need help|can you help me|i have (?:another )?question/i

const LETTER_RE = /[A-Za-z\u0590-\u05FF]/g

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

/** Emoji / punctuation / empty / fewer than two letters. Checked before real-question. */
export function isLowInformationInbound(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  const letters = t.match(LETTER_RE) ?? []
  return letters.length < 2
}

export function isGreetingOnly(text: string): boolean {
  const light = stripClassificationEmoji(text)
    .trim()
    .toLowerCase()
    .replace(/[?!.,;:־…]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!light) return false
  if (GREETING_EXACT.has(light)) return true
  const collapsed = collapseRepeatedLetters(light)
  if (GREETING_EXACT.has(collapsed)) return true
  for (const g of GREETING_EXACT) {
    if (collapseRepeatedLetters(g) === collapsed) return true
  }
  const tokens = light.split(' ').filter(Boolean)
  if (!tokens.length) return false
  let i = 0
  let sawCore = false
  while (i < tokens.length) {
    const tok = collapseRepeatedLetters(tokens[i] ?? '')
    if (GREETING_CORE.has(tok) || GREETING_CORE.has(tokens[i] ?? '')) {
      sawCore = true
      i += 1
      continue
    }
    if (GREETING_VOCATIVE.has(tok) || GREETING_VOCATIVE.has(tokens[i] ?? '')) {
      i += 1
      continue
    }
    const next = collapseRepeatedLetters(tokens[i + 1] ?? '')
    if (GREETING_TAIL.some(([a, b]) => a === tok && b === next)) {
      i += 2
      continue
    }
    return false
  }
  return sawCore
}

const HERE_TOKENS = new Set(['פה', 'כאן', 'here'])
const STAY_PRESENT_FILLER = new Set([
  'אני',
  'אנחנו',
  'עדיין',
  'רגע',
  'שנייה',
  'שניה',
  'חכה',
  'חכי',
  'חכו',
  'wait',
  'still',
  'i',
  'im',
  'am',
  'אחי',
  'אח',
  'bro',
  'man',
  'dude',
])
const STAY_PRESENT_REJECT = new Set([
  'מחר',
  'בהמשך',
  'אחר',
  'כך',
  'tomorrow',
  'later',
  'soon',
  'אחשוב',
  'think',
])

function stayPresentTokens(text: string): string[] {
  return collapseRepeatedLetters(
    stripClassificationEmoji(text)
      .toLowerCase()
      .replace(/\bi['’]m\b/g, 'i')
      .replace(/\bi am\b/g, 'i')
      .replace(/[?!.,;:־…']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .split(' ')
    .filter(Boolean)
}

function tokenMatches(set: Set<string>, tok: string): boolean {
  const key = collapseRepeatedLetters(tok)
  if (set.has(tok) || set.has(key)) return true
  for (const item of set) {
    if (collapseRepeatedLetters(item) === key) return true
  }
  return false
}

/**
 * Whole-utterance "I am still here" after a close-offer.
 * Requires a presence marker (פה / כאן / here) plus a filler/presence phrase.
 * Bare "פה" / "here" is not stay-present.
 */
export function isExplicitStayPresent(text: string): boolean {
  const tokens = stayPresentTokens(text)
  if (!tokens.length) return false
  let sawHere = false
  let sawFiller = false
  for (const tok of tokens) {
    if (tokenMatches(STAY_PRESENT_REJECT, tok)) return false
    if (tokenMatches(HERE_TOKENS, tok)) {
      sawHere = true
      continue
    }
    if (tokenMatches(STAY_PRESENT_FILLER, tok)) {
      sawFiller = true
      continue
    }
    return false
  }
  return sawHere && sawFiller
}

/**
 * Positive intent gate on the current inbound only.
 * Sticky PRODUCT_FIT / PRODUCT_QUESTION from prior turns is not intent.
 */
export function inboundHasMeaningfulSalesIntent(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t || isLowInformationInbound(t)) return false
  if (inboundContainsRealQuestion(t)) return true
  if (isExplicitHelpRequest(t)) return true
  if (isBusinessPainSignal(t)) return true
  if (HELP_RE.test(t) || HELP_RE.test(collapseRepeatedLetters(t))) return true
  return CURRENT_TEXT_INTENT_MOVES.has(classifySalesMove(t))
}

function run(reason: GptEligibilityReason): GptEligibility {
  return { decision: 'RUN_AI', reason }
}

function wait(reason: GptEligibilityReason): GptEligibility {
  return { decision: 'WAIT', reason }
}

/**
 * Call only after Conversation Control returns CONTINUE or ASK_QUESTION.
 * `controlAction` is accepted for traces; it does not authorize GPT.
 */
export function shouldInvokeSalesAi(input: GptEligibilityInput): GptEligibility {
  const inboundText = input.inboundText ?? ''
  const pendingQuestion = outboundAsksQuestion(input.previousOutbound)
  const afterWarning = input.previousOutboundKind === 'no_response_warning'

  if (isLowInformationInbound(inboundText)) return wait('LOW_INFORMATION')

  if (isHoldOnUtterance(inboundText)) return wait('HOLD_ON')

  if (afterWarning && isExplicitStayPresent(inboundText)) return run('STAY_PRESENT')

  if (HELP_RE.test(inboundText) || HELP_RE.test(collapseRepeatedLetters(inboundText))) return run('HELP')

  if (isShortAffirmative(inboundText) && pendingQuestion && !afterWarning) return run('PENDING_QUESTION')
  if (isShortAffirmative(inboundText)) return wait('SHORT_AFFIRMATIVE')

  if (isCasualAcknowledgement(inboundText)) return wait('ACKNOWLEDGEMENT')

  if (isGreetingOnly(inboundText)) {
    // Task 13: an unknown Contact deserves an answer to its opening greeting.
    if (input.customerInboundCount <= 1) return run('FIRST_TURN')
    // A greeting that is also a real question ("היי אחי מה קורה?") is a question
    // first; only a bare repeated greeting is social residue worth silencing.
    if (inboundContainsRealQuestion(inboundText)) return run('REAL_QUESTION')
    return wait('GREETING_REPEAT')
  }

  if (inboundContainsRealQuestion(inboundText)) return run('REAL_QUESTION')

  if (isBusinessPainSignal(inboundText)) return run('PAIN_SIGNAL')

  if (MEANINGFUL_MOVES.has(input.salesMove) && inboundHasMeaningfulSalesIntent(inboundText)) {
    return run(input.salesMove as GptEligibilityReason)
  }

  const normalized = normalizeUtterance(inboundText)
  const prev = input.previousCustomerText ? normalizeUtterance(input.previousCustomerText) : ''
  if (normalized && prev && normalized === prev && input.salesMove === 'DISCOVERY') {
    return wait('NO_NEW_CONTENT')
  }

  if (input.salesMove === 'DISCOVERY' && inboundHasMeaningfulSalesIntent(inboundText)) {
    if (input.customerInboundCount <= 1) return run('FIRST_TURN')
    return run('DISCOVERY')
  }

  return wait('NO_MEANINGFUL_INTENT')
}
