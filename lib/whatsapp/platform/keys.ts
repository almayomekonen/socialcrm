import crypto from 'node:crypto'
import { deriveSecretSubkey } from '@/lib/crypto/secrets'
import { ACTIVATION_CODE_ALPHABET } from './commands'

/**
 * Codes and sender hashes for the platform number. Both are keyed HMACs over
 * subkeys of the existing SECRETS_ENC_KEY, so no new secret is needed and
 * neither value can be reversed or brute-forced from the database alone.
 *
 * Rotating SECRETS_ENC_KEY changes every hash: outstanding codes stop working
 * (they live 15 minutes) and the sender history used for rate limiting and
 * opt-out ordering starts afresh. The binding opt-out is the recipient row,
 * keyed by the verified number, which a rotation does not touch.
 */

const CODE_PURPOSE = 'owner-wa-activation-code-v1'
const SENDER_PURPOSE = 'platform-wa-from-v1'

const hmac = (purpose: string, value: string) =>
  crypto.createHmac('sha256', deriveSecretSubkey(purpose)).update(value).digest('hex')

/** 8 characters from a 32-letter alphabet without I, O, 0, 1: 40 bits. Canonical form, no dash. */
export function generateActivationCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += ACTIVATION_CODE_ALPHABET[crypto.randomInt(ACTIVATION_CODE_ALPHABET.length)]
  return code
}

/** `ABCD2345` -> `ABCD-2345`, as shown to the user and prefilled in the message. */
export function formatActivationCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function hashActivationCode(code: string): string {
  return hmac(CODE_PURPOSE, code.toUpperCase())
}

/** `from` digits as Meta sends them (no plus). */
export function hashPlatformSender(fromDigits: string): string {
  return hmac(SENDER_PURPOSE, fromDigits)
}
