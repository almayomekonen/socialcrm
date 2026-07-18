import crypto from 'crypto'

function secret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    'dev-unsubscribe-secret'
  )
}

// Stateless unsubscribe token: an HMAC over the userId. No storage needed — the
// unsubscribe route recomputes and compares it.
export function signUnsubscribe(userId: number): string {
  return crypto.createHmac('sha256', secret()).update(`unsub:${userId}`).digest('hex')
}

export function verifyUnsubscribe(userId: number, token: string): boolean {
  if (!token) return false
  const expected = Buffer.from(signUnsubscribe(userId))
  const provided = Buffer.from(token)
  if (expected.length !== provided.length) return false
  return crypto.timingSafeEqual(expected, provided)
}
