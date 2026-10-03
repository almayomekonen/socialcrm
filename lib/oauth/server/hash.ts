import { createHash, randomBytes } from 'node:crypto'

/** SHA-256 hex — the only form in which authorization codes and refresh tokens are stored. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/** Opaque random credential, base64url (32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
