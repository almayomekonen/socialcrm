/**
 * resolvePageToken.cjs — CommonJS twin of lib/facebook/pageToken.ts for ops scripts.
 *
 * `facebook_pages.page_access_token` is sealed at rest (`scm1.` + AES-256-GCM
 * with SECRETS_ENC_KEY). Legacy plaintext rows pass through unchanged. Wire
 * format matches lib/crypto/secrets.ts: base64([12-byte IV | 16-byte tag | ciphertext]).
 * Never print the input or the output.
 */
const crypto = require('node:crypto')

const PREFIX = 'scm1.'

function resolvePageToken(stored) {
  if (!stored) return ''
  if (!String(stored).startsWith(PREFIX)) return stored
  const raw = process.env.SECRETS_ENC_KEY
  if (!raw) throw new Error('SECRETS_ENC_KEY is not set — cannot open a sealed Page token')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('SECRETS_ENC_KEY must decode to 32 bytes')
  const data = Buffer.from(String(stored).slice(PREFIX.length), 'base64')
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const enc = data.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

module.exports = { resolvePageToken }
