import { normalize, stripPrefix } from './driveIntentKeywords'

export type TokenInfo = { raw: string; stripped: string; normalized: string }

/**
 * Single tokenization pipeline used by both intent detection and query
 * building. Each token carries:
 *   raw        — the word as the user typed it
 *   stripped   — Hebrew prefix removed (used as the actual Drive search
 *                term, preserves final letters and case)
 *   normalized — lowercased + final-letter folded (used for keyword
 *                matching)
 */
export function tokenize(question: string): TokenInfo[] {
  return question
    .replace(/[.,;:!?"'()/[\]{}]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .map((raw) => {
      const stripped = stripPrefix(raw)
      return { raw, stripped, normalized: normalize(stripped) }
    })
    .filter((t) => t.stripped.length >= 2)
}
