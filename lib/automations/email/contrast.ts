/**
 * WCAG contrast, used as a GUARD rather than a report.
 *
 * A customer's brand colour is chosen for a logo on white, not for a button
 * label. A pale brand yellow with the default white label is unreadable, and the
 * customer cannot see that from the colour picker. So the label colour is never
 * configured — it is DERIVED from the accent, and the accent itself is checked
 * against the surface it sits on.
 *
 * Pure and dependency-free so it can be unit-tested and reused by the Builder.
 */

/** WCAG 2.2 AA floor for normal-size text. */
export const AA_NORMAL = 4.5
/** AA floor for large/bold text — a button label qualifies. */
export const AA_LARGE = 3

export type Rgb = { r: number; g: number; b: number }

/** Accepts `#rgb` and `#rrggbb`. Returns null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const raw = (hex ?? '').trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

const channel = (value: number): number => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a)
  const second = parseHex(b)
  if (!first || !second) return 1
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

const WHITE = '#ffffff'
const NEAR_BLACK = '#111111'

/**
 * The readable label colour for a given background — whichever of near-white or
 * near-black actually contrasts, not whichever the brand prefers.
 */
export function accessibleTextOn(background: string): string {
  return contrastRatio(WHITE, background) >= contrastRatio(NEAR_BLACK, background) ? WHITE : NEAR_BLACK
}

export type AccentDecision = {
  /** The accent to paint. The customer's, whenever it is a colour at all. */
  accent: string
  /** The derived label colour — never configured. */
  accentText: string
  /** A derived edge, so a pale fill still reads as a button. Never configured. */
  accentBorder: string
  /** True only when the input was missing or not a colour. */
  substituted: boolean
}

/** Blend a colour toward black. Used to derive an edge from a fill. */
export function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const k = Math.min(Math.max(1 - amount, 0), 1)
  const to2 = (v: number) =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, '0')
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`
}

/**
 * Resolve a customer accent into a usable trio: fill, label, edge.
 *
 * Neither of the two ways a branded button can fail is solved by rejecting
 * colours, so this rejects none.
 *
 * READABILITY is solved by deriving the label. On a solid fill, whichever of
 * near-white or near-black contrasts better always clears the large-text floor —
 * the worst case is mid-grey, where the better option still measures ~4.6:1. So
 * the label can always be made readable, and gating accents on readability would
 * be dead code.
 *
 * VISIBILITY — a pale fill on a pale surface reads as no button at all — is
 * solved by deriving an EDGE from the fill. A threshold was tried first and
 * rejected: the honest failure (near-white, ~1.01:1 on white) sits too close to
 * a legitimate brand yellow (~1.30:1) for any cutoff to separate them without
 * overriding real brands. Giving every fill a darker edge makes the invisible
 * button structurally impossible instead of arbitrarily disallowed.
 *
 * So a customer's brand colour is always honoured, and `substituted` is true only
 * when the input was not a colour at all.
 */
export function resolveAccent(requested: string | null | undefined, fallback: string): AccentDecision {
  const candidate = parseHex(requested ?? '') ? (requested as string).trim() : null
  const accent = candidate ?? fallback
  return {
    accent,
    accentText: accessibleTextOn(accent),
    accentBorder: darken(accent, 0.22),
    substituted: candidate === null && Boolean((requested ?? '').trim()),
  }
}
