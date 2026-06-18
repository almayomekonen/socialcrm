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
