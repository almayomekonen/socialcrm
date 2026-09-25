import { describe, it, expect } from 'vitest'
import { exactGrowIdentifier, tryExactGrowIdentifier, GrowIdentifierError } from '@/lib/payments/grow/identifiers'

/**
 * A transaction identifier that has been silently rounded names a DIFFERENT
 * transaction. Number.isInteger does not catch it — it approves the rounded
 * result — so these cases exist to keep that mistake out.
 */
describe('exactGrowIdentifier', () => {
  it('accepts what it can represent exactly, from a number or a bigint string', () => {
    expect(exactGrowIdentifier(1)).toBe(1)
    expect(exactGrowIdentifier('1789564403')).toBe(1789564403)
    expect(exactGrowIdentifier(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(exactGrowIdentifier(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses the value JavaScript would silently round', () => {
    // 2^53 + 1 becomes 2^53 under Number(), and Number.isInteger approves it.
    const unsafe = '9007199254740993'
    expect(Number.isInteger(Number(unsafe))).toBe(true) // the trap
    expect(() => exactGrowIdentifier(unsafe)).toThrow(GrowIdentifierError)
    expect(() => exactGrowIdentifier(unsafe)).toThrow(/not_exactly_representable/)
    expect(tryExactGrowIdentifier(unsafe)).toBeNull()
  })

  it('refuses anything that is not a positive whole number', () => {
    for (const bad of ['0', '-1', '1.5', '', ' ', 'abc', '1e3', null, undefined, {}, NaN, Infinity]) {
      expect(() => exactGrowIdentifier(bad), String(bad)).toThrow(GrowIdentifierError)
    }
  })

  it('never rounds: what comes back always round-trips to the input', () => {
    for (const raw of ['1', '42', '1789564403', String(Number.MAX_SAFE_INTEGER)]) {
      expect(String(exactGrowIdentifier(raw))).toBe(raw)
    }
  })
})
