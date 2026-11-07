/**
 * Whole-message WhatsApp opt-out and re-opt-in commands. Pure: no I/O, no model.
 *
 * A message is a command only when the WHOLE message, after normalisation,
 * equals one of the phrases below. A command quoted, negated or mentioned
 * inside a longer message is never a command, by construction:
 * "אל תעצור", "לא להסיר", "כתבתי לו עצור", "don't stop", "stop by tomorrow?".
 *
 * Normalisation, in order:
 *   NFKC; strip combining marks (niqqud, emoji variation selectors), format
 *   characters, punctuation and symbols (emoji included); collapse whitespace;
 *   lowercase; then drop politeness words, only at the start or end.
 *
 * The phrase lists are owner-approved (Phase 0 Item 3, 2026-11-06). Changing
 * them is a reviewed product change, not a tuning knob. `cancel`, `end` and
 * `quit` are deliberately absent: they are ordinary words in a sales chat.
 *
 * This is separate from `detectOptOut` (lib/inbox/autoresponse/optOutDetect.ts).
 * That broader, conversational detector stops the AI in its own conversation,
 * and only this classifier writes the business-wide opt-out.
 */

export const OPT_OUT_COMMANDS: readonly string[] = [
  // Hebrew
  'עצור',
  'הסר',
  'הסרה',
  'הסר אותי',
  'הסירו אותי',
  'תסירו אותי',
  'תפסיק',
  'תפסיקי',
  'תפסיקו',
  'הפסק',
  'הפסיקו',
  'אל תשלחו לי',
  'לא לשלוח לי',
  'נא להסיר אותי',
  // English
  'stop',
  'stop all',
  'stop messages',
  'stop texting',
  'unsubscribe',
  'unsubscribe me',
  'remove me',
  'opt out',
  'do not contact me',
]

export const OPT_IN_COMMANDS: readonly string[] = ['start', 'התחל', 'הרשמה מחדש']

/** Dropped only at the very start or end of the message, never in the middle. */
const POLITENESS_WORDS = new Set(['בבקשה', 'תודה', 'please', 'pls', 'plz', 'thanks'])

/** Longer than any command plus politeness words: not a command. */
const MAX_COMMAND_LENGTH = 80

const OPT_OUT_SET = new Set(OPT_OUT_COMMANDS)
const OPT_IN_SET = new Set(OPT_IN_COMMANDS)

export type OptOutCommand = 'opt_out' | 'opt_in'

export function normalizeCommandText(text: string): string {
  const words = text
    .normalize('NFKC')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
  while (words.length > 1 && POLITENESS_WORDS.has(words[0])) words.shift()
  while (words.length > 1 && POLITENESS_WORDS.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/** 'opt_out', 'opt_in', or null for every ordinary message. */
export function classifyOptOutCommand(text: unknown): OptOutCommand | null {
  if (typeof text !== 'string') return null
  if (!text.trim() || text.length > MAX_COMMAND_LENGTH) return null
  const normalized = normalizeCommandText(text)
  if (OPT_OUT_SET.has(normalized)) return 'opt_out'
  if (OPT_IN_SET.has(normalized)) return 'opt_in'
  return null
}
