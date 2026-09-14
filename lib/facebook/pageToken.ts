import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'

/**
 * Facebook Page access tokens at rest.
 *
 * `facebook_pages.page_access_token` was written as plaintext. New writes are
 * sealed with the project's existing AES-256-GCM helper (`SECRETS_ENC_KEY`),
 * behind the same `scm1.` prefix the WhatsApp manual-attach path already uses,
 * so both formats coexist on one column: prefixed → decrypt, anything else →
 * a legacy plaintext row that keeps working until its Page is reconnected.
 *
 * EVERY reader of the column goes through `resolvePageAccessToken`. A reader
 * that skips it would send ciphertext to Meta, get error 190, and mark a
 * healthy Page as disconnected — `__tests__/facebook/pageTokenReaders.test.ts`
 * fails the build if a new reader appears without it.
 *
 * Neither the plaintext nor the sealed value may ever be logged or returned to
 * a client. The prefix is not a secret.
 */
export const PAGE_TOKEN_SEAL_PREFIX = 'scm1.'

export function sealPageAccessToken(plaintext: string): string {
  const token = typeof plaintext === 'string' ? plaintext.trim() : ''
  if (!token) throw new Error('empty_page_access_token')
  return PAGE_TOKEN_SEAL_PREFIX + encryptSecret(token)
}

/**
 * Stored value → usable token. Throws when a sealed value cannot be opened
 * (missing or rotated `SECRETS_ENC_KEY`): every caller already sits inside a
 * try/catch that records a failure, and a throw there is honest where an empty
 * string would be misread by Meta as an expired token and disconnect the Page.
 */
export function resolvePageAccessToken(stored: string | null | undefined): string {
  if (stored == null || stored === '') return ''
  if (!stored.startsWith(PAGE_TOKEN_SEAL_PREFIX)) return stored
  return decryptSecret(stored.slice(PAGE_TOKEN_SEAL_PREFIX.length))
}

export function isSealedPageAccessToken(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PAGE_TOKEN_SEAL_PREFIX)
}
