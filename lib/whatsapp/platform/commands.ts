/**
 * The only two things a message to the SocialCRM platform number can do.
 *
 * OPT-OUT: the WHOLE message is one of הסר / הסרה / עצור / STOP (any case),
 * ignoring surrounding spaces, punctuation and symbols. "לא להסיר", "הסר את
 * הליד" and "stop it please" are not opt-outs. An opt-out wins over anything
 * else in the message.
 *
 * ACTIVATION: the message carries an activation code (`XXXX-XXXX`, the dash
 * required so an ordinary 8-letter word is never a code; any case). The
 * prefilled text around it does not matter.
 *
 * Everything else is ignored silently. Pure: no I/O.
 */

export const ACTIVATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const OPT_OUT_WORDS = new Set(['הסר', 'הסרה', 'עצור', 'stop'])
const MAX_COMMAND_LENGTH = 200
const CODE_PATTERN = /(?:^|[^A-Z0-9])([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})(?=$|[^A-Z0-9])/

export type PlatformCommand = { kind: 'opt_out' } | { kind: 'activation'; code: string } | { kind: 'other' }

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function isOptOutText(text: string): boolean {
  return OPT_OUT_WORDS.has(normalize(text))
}

/** The canonical code (8 characters, no dash), or null. */
export function extractActivationCode(text: string): string | null {
  const match = CODE_PATTERN.exec(text.normalize('NFKC').toUpperCase())
  return match ? match[1] + match[2] : null
}

export function parsePlatformCommand(text: unknown): PlatformCommand {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_COMMAND_LENGTH) return { kind: 'other' }
  if (isOptOutText(text)) return { kind: 'opt_out' }
  const code = extractActivationCode(text)
  return code ? { kind: 'activation', code } : { kind: 'other' }
}
