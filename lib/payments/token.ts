import { createHmac, timingSafeEqual } from 'crypto'

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

type TokenPayload = { a: number; t: number }
export type VerifiedToken = { agencyId: number; issuedAt: number }

function getSecret(): string {
  const secret = process.env.GROW_TOKEN_SECRET
  if (!secret) throw new Error('GROW_TOKEN_SECRET is not configured')
  return secret
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

export function signToken(agencyId: number): string {
  if (!Number.isInteger(agencyId) || agencyId <= 0) {
    throw new Error('Invalid agencyId')
  }
  const payload: TokenPayload = { a: agencyId, t: Date.now() }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = sign(payloadB64, getSecret())
  return `${payloadB64}.${sig}`
}

export function verifyToken(token: string): VerifiedToken {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format')
  }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) throw new Error('Invalid token format')

  const expected = sign(payloadB64, getSecret())
  const expectedBuf = Buffer.from(expected, 'base64url')
  const sigBuf = Buffer.from(sig, 'base64url')
  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
    throw new Error('Invalid token signature')
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid token payload')
  }

  if (typeof payload.a !== 'number' || typeof payload.t !== 'number') {
    throw new Error('Invalid token payload')
  }
  if (Date.now() - payload.t > TOKEN_TTL_MS) {
    throw new Error('Token expired')
  }

  return { agencyId: payload.a, issuedAt: payload.t }
}
