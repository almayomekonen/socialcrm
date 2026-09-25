/**
 * Transaction identifiers that reach Grow must be EXACT.
 *
 * `billing_charges.id` and `groupIdentifier` are bigserial, and node-postgres
 * hands bigints back as strings. `Number('9007199254740993')` yields
 * 9007199254740992 — a different transaction, silently — and `Number.isInteger`
 * happily approves the rounded result, so that check does not protect anything.
 *
 * These identifiers are what tells Grow which charge we mean. A wrong one is a
 * charge against the wrong transaction, or a duplicate. So: exact or refuse.
 * Nothing here rounds, and nothing widens the accepted range on a guess —
 * Grow's own integer limits are not documented and remain an open question, so
 * this only guarantees the value we send is the value we hold.
 */

export class GrowIdentifierError extends Error {
  constructor(
    public reason: 'not_an_integer' | 'not_positive' | 'not_exactly_representable',
    public raw: string,
  ) {
    super(`grow.identifier.${reason}`)
    this.name = 'GrowIdentifierError'
  }
}

/**
 * Accepts a number or a numeric string and returns it as a JS number only when
 * that number IS the value — `String(n) === raw` catches every silent rounding,
 * and the safe-integer check catches the range where rounding becomes possible.
 */
export function exactGrowIdentifier(value: unknown): number {
  const raw = typeof value === 'string' ? value.trim() : String(value)
  if (!/^\d+$/.test(raw)) throw new GrowIdentifierError('not_an_integer', raw)
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) throw new GrowIdentifierError('not_exactly_representable', raw)
  if (String(n) !== raw.replace(/^0+(?=\d)/, '')) throw new GrowIdentifierError('not_exactly_representable', raw)
  if (n <= 0) throw new GrowIdentifierError('not_positive', raw)
  return n
}

/** Non-throwing form, for callers that must degrade rather than fail a pass. */
export function tryExactGrowIdentifier(value: unknown): number | null {
  try {
    return exactGrowIdentifier(value)
  } catch {
    return null
  }
}
