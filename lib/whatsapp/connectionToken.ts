import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'

/**
 * WhatsApp Cloud API tokens.
 *
 * Embedded Signup historically stored `access_token` as plaintext. Manual
 * attach encrypts with the existing AES-256-GCM helper and a prefix so the
 * two formats can coexist: prefixed → decrypt; anything else → plaintext.
 *
 * Prefix is not a secret. Never log plaintext or sealed values.
 */
export const WHATSAPP_TOKEN_SEAL_PREFIX = 'scm1.'

export function sealWhatsappAccessToken(plaintext: string): string {
  const token = plaintext.trim()
  if (!token) throw new Error('empty_whatsapp_token')
  return WHATSAPP_TOKEN_SEAL_PREFIX + encryptSecret(token)
}

export function resolveWhatsappAccessToken(stored: string | null | undefined): string {
  if (stored == null || stored === '') return ''
  if (!stored.startsWith(WHATSAPP_TOKEN_SEAL_PREFIX)) return stored
  return decryptSecret(stored.slice(WHATSAPP_TOKEN_SEAL_PREFIX.length))
}
