import {
  HEAD_COUNT_ANSWER_WINDOW_HOURS,
  HEAD_COUNT_MAX,
  REPLY_ATTENDING,
  WEDDING_RSVP_SOURCE,
} from '@/lib/weddingRsvp/config'
import type { LatestOutbound } from '@/lib/weddingRsvp/history'

/** The whole message is a number, optionally followed by a people word: "4", "4 אנשים", " 12. " */
const HEAD_COUNT_PATTERN = /^\s*(\d{1,2})\s*(?:אנשים|איש|נפשות)?\s*[.!]*\s*$/u

/**
 * Pure. A head count only from a plain TEXT message that is nothing but a number
 * in 1..HEAD_COUNT_MAX. "4 בערב", "בעוד 4 דקות", a phone number, a list → null.
 */
export function parseHeadCount(raw: unknown): number | null {
  const m = (raw ?? {}) as { type?: unknown; text?: { body?: unknown } }
  if (m.type !== 'text' || typeof m.text?.body !== 'string') return null
  const match = HEAD_COUNT_PATTERN.exec(m.text.body)
  if (!match) return null
  const n = Number(match[1])
  return n >= 1 && n <= HEAD_COUNT_MAX ? n : null
}

/**
 * Pure. The number answers OUR question only when the latest outbound in the
 * conversation is the RSVP head-count question itself:
 *   - sent by this module (source 'wedding_rsvp') with the question text,
 *   - before this inbound message,
 *   - within HEAD_COUNT_ANSWER_WINDOW_HOURS.
 * Anything said to the guest after the question — a rep reply, a phone echo, a new
 * RSVP, or our own thank-you — makes the number ambiguous, so no reply. The
 * thank-you itself becomes the latest outbound, which is what makes it once-only.
 */
export function isHeadCountAnswer(latest: LatestOutbound | null, inboundMessageId: number, now: Date): boolean {
  if (!latest) return false
  if (latest.source !== WEDDING_RSVP_SOURCE || latest.text !== REPLY_ATTENDING) return false
  if (!(latest.id < inboundMessageId)) return false
  return now.getTime() - latest.createdAt.getTime() <= HEAD_COUNT_ANSWER_WINDOW_HOURS * 3600_000
}
