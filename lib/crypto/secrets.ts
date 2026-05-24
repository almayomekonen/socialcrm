import crypto from 'node:crypto'

// AES-256-GCM column encryption for tokens issued by external services
// (Google Drive refresh tokens, future Gmail/Calendar tokens, etc.).
//
// Wire format (base64-encoded):
//   [ 12-byte IV | 16-byte auth tag | ciphertext ]
//
// SECRETS_ENC_KEY must be 32 raw bytes, base64-encoded. Generate with:
//   openssl rand -base64 32

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENC_KEY
  if (!raw) throw new Error('[secrets] SECRETS_ENC_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`[secrets] SECRETS_ENC_KEY must decode to 32 bytes, got ${key.length}`)
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(blob: string): string {
  const key = getKey()
  const data = Buffer.from(blob, 'base64')
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('[secrets] ciphertext too short')
  }
  const iv = data.subarray(0, IV_LENGTH)
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const enc = data.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
