import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'

/**
 * WhatsApp Cloud API tokens at rest.
 *
 * `whatsapp_connections.access_token` is SEALED on every write: the `scm1.` prefix
 * plus AES-256-GCM with `SECRETS_ENC_KEY` (lib/crypto/secrets.ts). Rows written
 * before sealing are plaintext and keep working: prefixed → decrypt, anything else
 * → a legacy plaintext row, until `scripts/seal_whatsapp_tokens.cjs` seals it.
 *
 * EVERY writer goes through `sealWhatsappAccessToken` and EVERY reader through
 * `resolveWhatsappAccessToken`. `__tests__/whatsapp/whatsappTokenStorage.test.ts`
 * fails the build when a new reader or writer of the column skips them: a reader
 * that skips the resolver would send ciphertext to Meta, get error 190, and mark a
 * working number as disconnected.
 *
 * Never log, return to a client, or put in a URL either the plaintext or the sealed
 * value. The prefix is not a secret.
 */
export const WHATSAPP_TOKEN_SEAL_PREFIX = 'scm1.'

export function isSealedWhatsappAccessToken(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)
}

export function sealWhatsappAccessToken(plaintext: string): string {
  const token = typeof plaintext === 'string' ? plaintext.trim() : ''
  if (!token) throw new Error('empty_whatsapp_token')
  // A sealed value sealed again would resolve to ciphertext and be sent to Meta.
  if (isSealedWhatsappAccessToken(token)) throw new Error('whatsapp_token_already_sealed')
  return WHATSAPP_TOKEN_SEAL_PREFIX + encryptSecret(token)
}

/**
 * Stored value → usable token. Throws when a sealed value cannot be opened (missing
 * or different `SECRETS_ENC_KEY`): an empty string would reach Meta as an expired
 * token and mark a healthy number disconnected, which is the worse failure.
 */
export function resolveWhatsappAccessToken(stored: string | null | undefined): string {
  if (stored == null || stored === '') return ''
  if (!isSealedWhatsappAccessToken(stored)) return stored
  return decryptSecret(stored.slice(WHATSAPP_TOKEN_SEAL_PREFIX.length))
}
