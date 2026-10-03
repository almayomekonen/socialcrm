import { describe, it, expect } from 'vitest'
import { sha256Hex, randomToken } from '@/lib/oauth/server/hash'

describe('oauth hash helpers', () => {
  it('sha256Hex matches the known vector and is 64 lowercase hex chars', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('randomToken is base64url, 43 chars for 32 bytes, and unique', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const t = randomToken()
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
      seen.add(t)
    }
    expect(seen.size).toBe(200)
    expect(randomToken(24)).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})
