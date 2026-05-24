const REPEATED_LETTERS = /([א-תa-z])\1{2,}/giu
const REPEATED_PUNCT = /([!?.,])\1+/g
const REPEATED_EMOJI = /(\p{Extended_Pictographic})\1+/gu
const LAUGHTER_STRIP = /(?<![א-ת])[חה]{2,}(?![א-ת])/gu
const WHITESPACE = /\s+/g

const FILLERS: ReadonlySet<string> = new Set(['אחי', 'ברו', 'אחותי'])

export function normalizeInput(raw: string): string {
  if (typeof raw !== 'string') return ''

  let s = raw
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(LAUGHTER_STRIP, '')
    .replace(REPEATED_LETTERS, '$1')
    .replace(REPEATED_PUNCT, '$1')
    .replace(REPEATED_EMOJI, '$1')
    .replace(WHITESPACE, ' ')
    .trim()

  if (!s) return ''

  const tokens = s.split(/\s+/u).filter((t) => t.length > 0 && !FILLERS.has(t))
  return tokens.join(' ')
}
