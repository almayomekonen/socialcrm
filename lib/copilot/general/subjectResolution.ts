/**
 * Subject Resolution V1 — explicit lead reference detection (pure, no DB, no AI).
 *
 * Extracts a candidate lead name from a referential question ("מה עם דנה?",
 * "ספר לי על רון"). Conservative by design: it prefers returning null (→ the
 * caller stays in Business mode) over a false positive. Only explicit names —
 * no pronouns, no memory, no carry-over.
 */

/** Question words / common nouns that must never be treated as a lead name. */
const STOPWORDS = new Set([
  'מה',
  'מי',
  'זה',
  'זאת',
  'היום',
  'עכשיו',
  'הכל',
  'הכול',
  'כלום',
  'משהו',
  'מישהו',
  'השבוע',
  'החודש',
])

/**
 * Returns the candidate name, or null on any weak signal.
 * Rule: requires a referential preposition (עם / על / של); takes the tail after
 * the LAST one; rejects a definite-article noun ("ה…") or a stopword as the
 * first token; keeps at most two words (first + last name).
 */
export function extractLeadCandidate(text: string): string | null {
  const t = text.trim().replace(/[?!.,؛;]+$/u, '')
  // Greedy prefix → capture the tail after the LAST preposition.
  const m = t.match(/.*(?:\s|^)(?:עם|על|של)\s+(.+)$/u)
  if (!m) return null

  const tail = m[1].trim()
  if (!tail) return null

  const words = tail.split(/\s+/u).slice(0, 2)
  const first = words[0]
  if (!first) return null
  if (first.startsWith('ה')) return null // definite article → a noun, not a name
  if (STOPWORDS.has(first)) return null

  const candidate = words.join(' ').trim()
  return candidate.length >= 2 ? candidate : null
}

// ── Lead follow-up signal (3 deterministic classes; tokenized whole-word only) ──
// Gates whether an otherwise-unknown question, with a lead subject active, is a
// follow-up about that lead. Business-wide questions exhibit none of these.

/** Class 1 — person pronouns/possessives. */
const PRONOUNS = new Set(['היא', 'הוא', 'איתה', 'איתו', 'שלה', 'שלו', 'אותה', 'אותו', 'עליה', 'עליו'])
/** Class 2 — message draft / contact imperatives (askLeadQuestion serves these). */
const DRAFT_VERBS = new Set(['תכתוב', 'כתוב', 'תשלח', 'שלח', 'נסח', 'תנסח', 'טיוטה', 'הודעה', 'תתקשר', 'תקבע'])
/** Class 3 — lead-context nouns (single words + fixed phrases). */
const LEAD_NOUN_WORDS = new Set(['סטטוס', 'סיכום', 'סכם', 'תסכם', 'היסטוריה', 'פרטים'])
const LEAD_NOUN_PHRASES = ['הצעד הבא', 'השלב הבא', 'מתי דיברנו', 'מה דיברנו', 'על מה דיברנו']

/**
 * True only when the text carries a lead-follow-up signal from one of the three
 * classes. Tokenized whole-word matching — never substring (so "שלה" cannot match
 * inside "בשלה"). No other heuristics.
 */
export function isLeadFollowup(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/u)
    .map((t) => t.replace(/[?!.,؛;:"'()]+/gu, ''))
    .filter(Boolean)
  if (tokens.length === 0) return false
  // De-article only for the noun class (Hebrew nouns appear as "הסטטוס", not "סטטוס").
  const deArticle = (w: string) => (w.startsWith('ה') && w.length > 2 ? w.slice(1) : w)
  for (const w of tokens) {
    if (PRONOUNS.has(w) || DRAFT_VERBS.has(w) || LEAD_NOUN_WORDS.has(w) || LEAD_NOUN_WORDS.has(deArticle(w))) return true
  }
  const joined = ` ${tokens.join(' ')} ` // space-bounded → phrase match stays whole-word
  return LEAD_NOUN_PHRASES.some((p) => joined.includes(` ${p} `))
}
