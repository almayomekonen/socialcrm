/**
 * What the customer said about a question without choosing an option, kept
 * against that question for the rep. Pure.
 *
 * APPEND ONLY. A note grows in arrival order, once per distinct message, and
 * nothing else writes its key: an answer to the question sits beside it and
 * never replaces it. The whole note is capped at NOTE_MAX_CHARS so one message
 * cannot flood the summary; the complete message always stays in
 * inbox_messages, which is where a rep reads the original.
 */
import { noteKey } from './answerKeys'
import { normalizeForMatch } from './parseAnswer'
import { isFillerOnly } from './validateAnswer'

export const NOTE_MAX_CHARS = 1000
const CUT = '…'

/** At most `max` characters, marked with "…" when cut, never splitting an emoji in half. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text
  let head = text.slice(0, Math.max(0, max - 1))
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
  return `${head}${CUT}`
}

/** "נציג", "אפשר לדבר עם מישהו", "בבקשה": the request itself, which tells the rep nothing. */
const PERSON_REQUEST =
  /אפשר לדבר עם|לדבר עם|אפשר לדבר|נציג(?:ה|ים)?|בן אדם|בנאדם|אדם אמיתי|מישהו|תעביר(?:י)? אותי|תחבר(?:י)? אותי|בבקשה|אפשר|רוצה|אני/g

export function appendNote(
  answers: Record<string, string[]>,
  stepId: string,
  texts: readonly string[],
): Record<string, string[]> {
  const key = noteKey(stepId)
  const prior = answers[key] ?? []
  const next = [...prior]
  let used = prior.reduce((n, t) => n + t.length, 0)
  for (const raw of texts) {
    const text = normalizeForMatch(raw)
    if (!text || next.includes(text)) continue
    const room = NOTE_MAX_CHARS - used
    if (room <= 1) break
    const kept = capText(text, room)
    next.push(kept)
    used += kept.length
  }
  return next.length === prior.length ? answers : { ...answers, [key]: next }
}

/** The note as one line for the rep, or null when there is none. */
export function noteText(answers: Record<string, string[]>, stepId: string): string | null {
  const parts = answers[noteKey(stepId)] ?? []
  return parts.length ? parts.join('; ') : null
}

/** From a turn that asked for a person: the messages that said more than the request itself. */
export function handoffWords(texts: readonly string[]): string[] {
  return texts.filter((t) => {
    const rest = normalizeForMatch(t).replace(PERSON_REQUEST, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    return rest !== '' && !isFillerOnly(rest)
  })
}
