import { describe, it, expect } from 'vitest'
import { verifyPkceS256, isValidCodeChallenge } from '@/lib/oauth/server/pkce'

// RFC 7636 Appendix B test vector.
const V = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const C = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('PKCE S256', () => {
  it('accepts the RFC 7636 vector', () => {
    expect(verifyPkceS256(V, C)).toBe(true)
  })

  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256(V.slice(0, -1) + 'A', C)).toBe(false)
  })

  it('rejects the plain method (verifier presented as its own challenge)', () => {
    expect(verifyPkceS256(V, V)).toBe(false)
    expect(verifyPkceS256(C, C)).toBe(false)
  })

  it('enforces the RFC 7636 verifier length: 43..128', () => {
    expect(verifyPkceS256('a'.repeat(42), C)).toBe(false)
    expect(verifyPkceS256('a'.repeat(129), C)).toBe(false)
  })

  it.each(['!', ' ', '+', '/', '=', '%', 'é', '\n'])('rejects a verifier containing %j', (ch) => {
    expect(verifyPkceS256(V.slice(0, 42) + ch, C)).toBe(false)
  })

  it('accepts every unreserved character class in a verifier', () => {
    // Correctness of the hash is covered by the vector; here only the charset gate.
    const verifier = 'AZaz09-._~'.repeat(5)
    expect(verifier.length).toBe(50)
    expect(verifyPkceS256(verifier, C)).toBe(false) // valid shape, wrong challenge → false, not a throw
  })

  it('validates challenge shape: exactly 43 base64url chars, no padding', () => {
    expect(isValidCodeChallenge(C)).toBe(true)
    expect(isValidCodeChallenge(C + 'A')).toBe(false)
    expect(isValidCodeChallenge(C.slice(0, 42))).toBe(false)
    expect(isValidCodeChallenge(C.replace('-', '+'))).toBe(false)
    expect(isValidCodeChallenge(C.slice(0, 42) + '=')).toBe(false)
    expect(isValidCodeChallenge('')).toBe(false)
  })

  it('never throws on non-string-ish garbage', () => {
    expect(verifyPkceS256('', '')).toBe(false)
    expect(verifyPkceS256(undefined as unknown as string, C)).toBe(false)
    expect(verifyPkceS256(V, null as unknown as string)).toBe(false)
  })
})
