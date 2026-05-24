import { INTENTS, type Intent, type SocialIntent } from './intents'
import { MODEL, type FeatureName } from './localClassifierModel'

// ─────────────────────────────────────────────────────────────────────────
// Pattern atoms — small, semantic, NOT exhaustive keyword lists.
// Each is one signal among many fed into the classifier model. The model
// weights decide how much each signal counts.
// ─────────────────────────────────────────────────────────────────────────

const HEBREW = '\\u05D0-\\u05EA'

// Hebrew word boundary helpers. JS \b is ASCII-only, useless for Hebrew.
// "(?<![א-ת])word(?![א-ת])" asserts non-Hebrew on both sides, so "ליד"
// matches in "ליד שלי" but not in "לידה" (followed by ה).
function hebrewWord(alternation: string): string {
  return `(?<![${HEBREW}])(?:${alternation})(?![${HEBREW}])`
}

// "ליד" with optional prefix particle (ל, ב, מ, ש, ה, כ, ו) attached —
// covers "לליד", "מהליד", etc., which all reference the lead.
function hebrewWordWithPrefix(alternation: string): string {
  return `(?<![${HEBREW}])[הלבמשכו]*(?:${alternation})(?![${HEBREW}])`
}

const SOCIAL_PATTERNS: Record<SocialIntent, RegExp> = {
  'social.gratitude': new RegExp(
    `${hebrewWord('תודה(?:\\s+רבה)?')}|\\b(?:thanks|thank\\s+you|thx|ty)\\b`,
    'iu',
  ),
  'social.greeting': new RegExp(
    `${hebrewWord('בוקר\\s+טוב|ערב\\s+טוב|צהריים\\s+טובים|שלום|היי')}|\\b(?:hi|hello|hey|good\\s+(?:morning|evening|afternoon))\\b`,
    'iu',
  ),
  'social.positive': new RegExp(
    `${hebrewWord('מעולה|מושלם|סבבה|יפה')}|\\b(?:nice|cool|perfect|great|awesome)\\b`,
    'iu',
  ),
  'social.farewell': new RegExp(
    `${hebrewWord('ביי|נתראה|להתראות|יום\\s+טוב|לילה\\s+טוב')}|\\b(?:bye|goodbye|see\\s+you|cya|good\\s+night)\\b`,
    'iu',
  ),
}

const HEBREW_QUESTION_WORDS = new RegExp(hebrewWord('מה|איך|כמה|למה|מי|איפה|מתי'), 'u')
const ENGLISH_QUESTION_WORDS = /\b(?:what|how|why|when|where|who)\b/iu
const HEBREW_IMPERATIVE = new RegExp(`(?:^|\\s)ת[${HEBREW}]{2,5}\\b`, 'u')
const FILE_NOUNS = new RegExp(
  `${hebrewWordWithPrefix('מסמך|קובץ|חוזה|תמונה')}|\\b(?:pdf|excel|word|doc|file)\\b`,
  'iu',
)
const LEAD_REFS = new RegExp(
  `${hebrewWordWithPrefix('ליד|לקוח')}|\\b(?:lead|client)\\b`,
  'iu',
)
// Standalone laughter signal: 2+ ח/ה NOT adjacent to other Hebrew letters.
// Prevents false-positive on words ending in repeated ה (e.g., "תודההההה").
const LAUGHTER = /(?<![א-ת])[חה]{2,}(?![א-ת])/u
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const QUESTION_MARK = /[?؟]/u

// ─────────────────────────────────────────────────────────────────────────
// Stage 1: extractSignals — raw observations from the text
// ─────────────────────────────────────────────────────────────────────────

export type SocialPatternPosition = 'full' | 'anchored' | 'substring'

export type Signals = {
  tokenCount: number
  emojiCount: number
  hasQuestionMark: boolean
  hasLaughterPattern: boolean
  startsWithHebrewImperative: boolean
  hasQuestionWord: boolean
  hasFileTypeNoun: boolean
  hasLeadReference: boolean
  socialPatternType: SocialIntent | null
  socialPatternPosition: SocialPatternPosition | null
}

export function extractSignals(normalized: string, original: string): Signals {
  const tokens = normalized.split(/\s+/u).filter(Boolean)
  const emojiCount = (normalized.match(EMOJI_RE) ?? []).length

  let socialPatternType: SocialIntent | null = null
  let socialPatternPosition: SocialPatternPosition | null = null

  // Try each social pattern; record the FIRST hit (intents are ordered by
  // priority — gratitude > greeting > positive > farewell in the enum).
  for (const intent of Object.keys(SOCIAL_PATTERNS) as SocialIntent[]) {
    const pattern = SOCIAL_PATTERNS[intent]
    const m = normalized.match(pattern)
    if (!m) continue
    socialPatternType = intent
    const matched = m[0]
    if (matched === normalized) {
      socialPatternPosition = 'full'
    } else if (tokens[0] === matched || tokens[tokens.length - 1] === matched) {
      socialPatternPosition = 'anchored'
    } else {
      socialPatternPosition = 'substring'
    }
    break
  }

  return {
    tokenCount: tokens.length,
    emojiCount,
    hasQuestionMark: QUESTION_MARK.test(normalized),
    hasLaughterPattern: LAUGHTER.test(original),
    startsWithHebrewImperative: HEBREW_IMPERATIVE.test(normalized),
    hasQuestionWord: HEBREW_QUESTION_WORDS.test(normalized) || ENGLISH_QUESTION_WORDS.test(normalized),
    hasFileTypeNoun: FILE_NOUNS.test(normalized),
    hasLeadReference: LEAD_REFS.test(normalized),
    socialPatternType,
    socialPatternPosition,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 2: buildFeatureVector — convert signals → numeric feature vector
// ─────────────────────────────────────────────────────────────────────────

export type FeatureVector = Record<FeatureName, number>

function emptyVector(): FeatureVector {
  return {
    bias: 1,
    is_short_1: 0,
    is_short_2: 0,
    is_short_3: 0,
    is_long: 0,
    emoji_density: 0,
    emoji_only: 0,
    laughter: 0,
    question_mark: 0,
    imperative_start: 0,
    question_word: 0,
    file_noun: 0,
    lead_ref: 0,
    social_gratitude_full: 0,
    social_gratitude_anchored: 0,
    social_gratitude_substring: 0,
    social_greeting_full: 0,
    social_greeting_anchored: 0,
    social_greeting_substring: 0,
    social_positive_full: 0,
    social_positive_anchored: 0,
    social_positive_substring: 0,
    social_farewell_full: 0,
    social_farewell_anchored: 0,
    social_farewell_substring: 0,
  }
}

export function buildFeatureVector(signals: Signals): FeatureVector {
  const v = emptyVector()

  if (signals.tokenCount === 1) v.is_short_1 = 1
  else if (signals.tokenCount === 2) v.is_short_2 = 1
  else if (signals.tokenCount === 3) v.is_short_3 = 1
  else if (signals.tokenCount >= 4) v.is_long = 1

  v.emoji_density = signals.tokenCount > 0 ? Math.min(1, signals.emojiCount / signals.tokenCount) : 0
  v.emoji_only = signals.tokenCount > 0 && signals.emojiCount === signals.tokenCount ? 1 : 0

  v.laughter = signals.hasLaughterPattern ? 1 : 0
  v.question_mark = signals.hasQuestionMark ? 1 : 0
  v.imperative_start = signals.startsWithHebrewImperative ? 1 : 0
  v.question_word = signals.hasQuestionWord ? 1 : 0
  v.file_noun = signals.hasFileTypeNoun ? 1 : 0
  v.lead_ref = signals.hasLeadReference ? 1 : 0

  if (signals.socialPatternType && signals.socialPatternPosition) {
    const intentKey = signals.socialPatternType.replace('.', '_')
    const key = `${intentKey}_${signals.socialPatternPosition}` as FeatureName
    if (key in v) v[key] = 1
  }

  return v
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 3: predict — multinomial logistic regression
// ─────────────────────────────────────────────────────────────────────────

export type Prediction = { intent: Intent; confidence: number }

export function predict(features: FeatureVector): Prediction {
  const logits: Record<Intent, number> = {} as Record<Intent, number>
  for (const intent of INTENTS) {
    const coeffs = MODEL[intent]
    let logit = 0
    for (const [feature, value] of Object.entries(features) as Array<[FeatureName, number]>) {
      if (value === 0) continue
      const w = coeffs[feature]
      if (w !== undefined) logit += w * value
    }
    logits[intent] = logit
  }

  // Numerically-stable softmax: subtract max before exponentiating.
  let maxLogit = -Infinity
  for (const intent of INTENTS) if (logits[intent] > maxLogit) maxLogit = logits[intent]

  const exps: Record<Intent, number> = {} as Record<Intent, number>
  let sumExp = 0
  for (const intent of INTENTS) {
    const e = Math.exp(logits[intent] - maxLogit)
    exps[intent] = e
    sumExp += e
  }

  let topIntent: Intent = 'unknown'
  let topProb = 0
  for (const intent of INTENTS) {
    const prob = exps[intent] / sumExp
    if (prob > topProb) {
      topProb = prob
      topIntent = intent
    }
  }

  return { intent: topIntent, confidence: topProb }
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────

export function quickClassifyIntent(normalized: string, original: string): Prediction {
  const signals = extractSignals(normalized, original)
  const features = buildFeatureVector(signals)
  return predict(features)
}
