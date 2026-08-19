/**
 * Delivery-only classifier for IRE qualify replies.
 * Does not decide whether to answer, close, or hand off.
 * Pure: no DB, I/O, or LLM.
 */
export type ResponseTone = 'casual' | 'neutral' | 'professional'
export type ResponseEmotion = 'neutral' | 'positive' | 'frustrated' | 'confused'
export type ResponseUrgency = 'low' | 'normal' | 'high'
export type ResponseLanguage = 'he' | 'en'
export type ResponseStyle = 'short' | 'conversational' | 'detailed'

export type ResponseProfile = {
  tone: ResponseTone
  emotion: ResponseEmotion
  urgency: ResponseUrgency
  language: ResponseLanguage
  customerStyle: ResponseStyle
  establishedTone: ResponseTone
  vocative: string | null
}

export type ClassifyResponseProfileInput = {
  lastInbound: string
  recentCustomerTexts?: string[]
}

const HEBREW_RE = /[֐-׿]/

const PROFESSIONAL_RE =
  /שלום|אשמח|ברצוני|אודה|הצעת מחיר מסודרת|\bplease\b|i would like/i

const CASUAL_RE = /אחי|אחלה|יאללה|מה קורה|מה נשמע|(?:^|\s)היי(?:\s|$|[?!.,])|\bhey\b|what['’]?s up/i

const FRUSTRATED_RE = /מתוסכל|נמאס|מאבד|לאיבוד|frustrated|sick of/i
const CONFUSED_RE = /לא הבנתי|לא ברור|what do you mean/i
const POSITIVE_RE = /תודה|אחלה|מעולה/

const HIGH_URGENCY_RE = /עכשיו|חייב|היום|\basap\b|\burgent\b/i
const GREETING_RE = /(?:^|\s)(?:היי|הי|שלום|hi|hey|hello)(?:\s|$|[?!.,])|מה קורה|מה נשמע|what['’]?s up/i

function normalize(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean)
}

function sentenceCount(text: string): number {
  return normalize(text)
    .split(/[.!?؟]+/)
    .map((s) => s.trim())
    .filter(Boolean).length
}

export function classifyLanguage(text: string): ResponseLanguage {
  return HEBREW_RE.test(text ?? '') ? 'he' : 'en'
}

/** Vocative from the current inbound only. Never inferred from history. */
export function detectVocative(text: string): string | null {
  const raw = text ?? ''
  if (/(?:^|[^\u0590-\u05FF])אחי(?=$|[^\u0590-\u05FF])/u.test(raw)) return 'אחי'
  if (/\bbro\b/i.test(raw)) return 'bro'
  if (/\bdude\b/i.test(raw)) return 'dude'
  return null
}

function classifyTone(text: string): ResponseTone {
  const t = text ?? ''
  const professional = PROFESSIONAL_RE.test(t)
  const casual = CASUAL_RE.test(t)
  if (professional) return 'professional'
  if (casual) return 'casual'
  return 'neutral'
}

function classifyEmotion(text: string): ResponseEmotion {
  const t = text ?? ''
  if (FRUSTRATED_RE.test(t)) return 'frustrated'
  if (CONFUSED_RE.test(t)) return 'confused'
  if (POSITIVE_RE.test(t)) return 'positive'
  return 'neutral'
}

function classifyStyle(text: string): ResponseStyle {
  const trimmed = normalize(text)
  const n = tokens(trimmed).length
  if (trimmed.length < 24 && n <= 4) return 'short'
  if (trimmed.length > 180 || sentenceCount(trimmed) >= 3) return 'detailed'
  return 'conversational'
}

function classifyUrgency(text: string, style: ResponseStyle): ResponseUrgency {
  const t = text ?? ''
  if (HIGH_URGENCY_RE.test(t)) return 'high'
  if (style === 'short' && GREETING_RE.test(t)) return 'low'
  return 'normal'
}

function previousTexts(lastInbound: string, recent: string[] | undefined): string[] {
  const list = (recent ?? []).filter((t) => typeof t === 'string')
  if (list.length === 0) return []
  const withoutCurrent = list[list.length - 1] === lastInbound ? list.slice(0, -1) : list
  return withoutCurrent.slice(-2)
}

export function classifyResponseProfile(input: ClassifyResponseProfileInput): ResponseProfile {
  const lastInbound = input.lastInbound ?? ''
  const tone = classifyTone(lastInbound)
  const previous = previousTexts(lastInbound, input.recentCustomerTexts)
  const priorTones = previous.map(classifyTone)
  const establishedTone = priorTones.includes('casual')
    ? 'casual'
    : priorTones.includes('professional')
      ? 'professional'
      : priorTones[priorTones.length - 1] ?? tone
  const customerStyle = classifyStyle(lastInbound)

  return {
    tone,
    emotion: classifyEmotion(lastInbound),
    urgency: classifyUrgency(lastInbound, customerStyle),
    language: classifyLanguage(lastInbound),
    customerStyle,
    establishedTone,
    vocative: detectVocative(lastInbound),
  }
}
