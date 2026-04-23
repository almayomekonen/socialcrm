/**
 * Token system — pure unit tests.
 * No DB, no Next.js, no mocks. Proves HMAC + expiry + tamper-resistance.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'

const ORIGINAL_SECRET = process.env.GROW_TOKEN_SECRET

beforeAll(() => {
  process.env.GROW_TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
})

afterEach(() => {
  process.env.GROW_TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
})

import { signToken, verifyToken } from '@/lib/payments/token'

describe('payments/token', () => {
  it('round-trips a valid token to the same agencyId', () => {
    const token = signToken(42)
    const verified = verifyToken(token)
    expect(verified.agencyId).toBe(42)
    expect(verified.issuedAt).toBeGreaterThan(0)
  })

  it('rejects a token with a tampered payload', () => {
    const token = signToken(7)
    const [payload, sig] = token.split('.')
    // flip one byte in the payload
    const tampered = payload.slice(0, -2) + (payload.slice(-2) === 'AA' ? 'AB' : 'AA') + '.' + sig
    expect(() => verifyToken(tampered)).toThrow(/signature/i)
  })

  it('rejects a token with a tampered signature', () => {
    const token = signToken(7)
    const [payload, sig] = token.split('.')
    const tampered = payload + '.' + sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A')
    expect(() => verifyToken(tampered)).toThrow(/signature/i)
  })

  it('rejects an expired token (older than 1 hour)', () => {
    const token = signToken(99)
    // Decode payload, rewrite ts to >1h ago, re-sign with the SAME secret to isolate the expiry check
    const [payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    payload.t = Date.now() - 60 * 60 * 1000 - 1000
    const newPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const { createHmac } = require('crypto') as typeof import('crypto')
    const newSig = createHmac('sha256', process.env.GROW_TOKEN_SECRET!).update(newPayloadB64).digest('base64url')
    const expired = `${newPayloadB64}.${newSig}`
    expect(() => verifyToken(expired)).toThrow(/expired/i)
  })

  it('rejects a token signed with a different secret (key rotation safety)', () => {
    const token = signToken(5)
    process.env.GROW_TOKEN_SECRET = 'different_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    expect(() => verifyToken(token)).toThrow(/signature/i)
  })

  it('rejects malformed input', () => {
    expect(() => verifyToken('')).toThrow()
    expect(() => verifyToken('no-dot')).toThrow()
    expect(() => verifyToken('a.b.c')).toThrow()
    // @ts-expect-error
    expect(() => verifyToken(null)).toThrow()
  })

  it('rejects invalid agencyId at sign time', () => {
    expect(() => signToken(0)).toThrow(/agencyId/i)
    expect(() => signToken(-1)).toThrow(/agencyId/i)
    expect(() => signToken(1.5)).toThrow(/agencyId/i)
  })

  it('throws if GROW_TOKEN_SECRET is missing', () => {
    delete process.env.GROW_TOKEN_SECRET
    expect(() => signToken(1)).toThrow(/GROW_TOKEN_SECRET/)
  })
})
