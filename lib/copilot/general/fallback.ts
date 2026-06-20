/**
 * General Mode fallback — replaces the old dead-end non-answer.
 * Deterministic, tokenized (whole-word). Three modes; REDIRECT is the default.
 * Principle: never dead-end, never pretend — admit a limit, then pivot.
 *
 * Known gaps are recognized so they get an HONEST named acknowledgment AND a
 * measurable analytics tag (not dumped into generic "unknown"). This is a copy
 * selector, not routing — it changes wording only.
 *
 * OWNERSHIP / REMOVAL — each known gap below must be removed (or flipped off)
 * when its capability ships, or the acknowledgment becomes a lie:
 *   - 'results'  → remove when closing/lead-outcome metrics ship.
 *   - 'revenue'  → remove when revenue/deal-value reporting ships.
 *   - 'source'   → remove when lead-source analysis ships.
 */

export type KnownGap = 'results' | 'revenue' | 'source'

export type FallbackResult = { mode: 'ack' } | { mode: 'clarify' } | { mode: 'redirect'; gap: KnownGap | null }

/** Strict acknowledgement set — ACK fires only when EVERY content token is here. */
const ACK = new Set([
  'תודה',
  'רבה',
  'סבבה',
  'מעולה',
  'מצוין',
  'הבנתי',
  'אחלה',
  'יופי',
  'מגניב',
  'גדול',
  'סחתיין',
  'אוקיי',
  'אוקי',
  'אוק',
  'ok',
  'okay',
  'thanks',
  'thx',
])

/** Bare interrogatives → CLARIFY (length-gated so substantive questions don't match). */
const INTERROGATIVES = new Set(['למה', 'איך', 'מה', 'מי', 'מתי', 'איפה', 'כמה', 'מדוע'])
const CLARIFY_PHRASES = ['מה זאת אומרת', 'מה הכוונה', 'כלומר']

/** Known-gap signals — SPECIFIC tokens/phrases only (never bare כמה/כסף/מקור). */
const GAP_RESULTS = new Set(['סגרתי', 'נסגרו', 'סגירות', 'סגירה'])
const GAP_REVENUE = new Set(['כסף', 'הכנסה', 'הכנסות', 'רווח', 'הרווחתי'])
const GAP_SOURCE_TOKENS = new Set(['מקורות'])
const GAP_SOURCE_PHRASES = ['מאיזה מקור', 'מאיפה מגיעים', 'מקור הלידים', 'איזה מקור']

function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/u)
    .map((t) => t.replace(/[?!.,؛;:"'()]+/gu, ''))
    .filter(Boolean)
}

/**
 * Known unsupported business questions (results/revenue/source). SINGLE source
 * of truth for gap detection — used by the pre-classification gate in resolveAnswer
 * (intercept before the LLM) AND by classifyFallback below. No duplicated keywords.
 */
export function detectKnownGap(text: string): KnownGap | null {
  const tokens = tokenize(text)
  if (tokens.length === 0) return null
  const joined = ` ${tokens.join(' ')} `
  if (tokens.some((t) => GAP_RESULTS.has(t))) return 'results'
  if (tokens.some((t) => GAP_REVENUE.has(t))) return 'revenue'
  if (tokens.some((t) => GAP_SOURCE_TOKENS.has(t)) || GAP_SOURCE_PHRASES.some((p) => joined.includes(` ${p} `)))
    return 'source'
  return null
}

/**
 * Classify an otherwise-unknown question into a fallback mode. Order matters:
 * ack → known-gap → clarify → generic redirect. Known-gap is checked before
 * clarify so "כמה סגרתי" is a results gap, not a bare-interrogative clarify.
 */
export function classifyFallback(text: string): FallbackResult {
  const tokens = tokenize(text)
  if (tokens.length === 0) return { mode: 'redirect', gap: null }
  const joined = ` ${tokens.join(' ')} `

  if (tokens.every((t) => ACK.has(t))) return { mode: 'ack' }

  const gap = detectKnownGap(text)
  if (gap) return { mode: 'redirect', gap }

  if ((tokens.length <= 2 && tokens.some((t) => INTERROGATIVES.has(t))) || CLARIFY_PHRASES.some((p) => joined.includes(` ${p} `)))
    return { mode: 'clarify' }

  return { mode: 'redirect', gap: null }
}

const GAP_COPY: Record<KnownGap, string> = {
  results: 'מספרי הסגירות זה משהו שאני עדיין לא מציג. בינתיים אפשר לשאול:',
  revenue: 'נתוני הכנסה אני עדיין לא יודע להציג. מה שכן אפשר:',
  source: 'ניתוח לפי מקור לידים עוד לא זמין אצלי. בינתיים:',
}

/** Honest, dead-end-free copy for each fallback outcome. */
export function fallbackCopy(r: FallbackResult): string {
  if (r.mode === 'ack') return 'בכיף. אם צריך עוד משהו, אני כאן.'
  if (r.mode === 'clarify') return 'לא בטוח שהבנתי — אפשר לפרט על מה השאלה?'
  return r.gap ? GAP_COPY[r.gap] : 'את זה אני עדיין לא יודע לענות. מה שכן אפשר לשאול:'
}
