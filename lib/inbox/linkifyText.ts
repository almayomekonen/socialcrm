export type TextSegment = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string }

// http(s)://… or www.… up to the next whitespace. Only these two shapes are
// linked, so the href can never become a javascript:/data: URL.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi

// Punctuation that usually ends the sentence, not the URL ("ראה https://x.com.").
const TRAILING_PUNCT = /[.,;:!?'")\]}]+$/

// Splits message text into plain-text and link segments for rendering.
export function linkifyText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const url = match[0].replace(TRAILING_PUNCT, '')
    if (!url) continue
    if (start > last) segments.push({ kind: 'text', value: text.slice(last, start) })
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    segments.push({ kind: 'link', value: url, href })
    last = start + url.length
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) })
  return segments
}
