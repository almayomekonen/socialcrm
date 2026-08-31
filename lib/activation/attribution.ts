/**
 * Signup attribution — where a registration actually came from.
 *
 * WHY THIS EXISTS. The activation audit could not attribute a single signup to a
 * campaign. The one production case that prompted this work arrived from a
 * Facebook ad on a phone, and the ONLY evidence of that origin anywhere in the
 * system was a User-Agent string containing `FB_IAB` — recovered by hand, after
 * the fact, from `users_info.ips`. `registration_completed` carried
 * `{ device, isPhone }` and nothing else.
 *
 * THE SHAPE IS DELIBERATE — it is the pattern registration already uses.
 * `addAgency()` sets a short-lived `scrm_reg` cookie that survives redirects and
 * layout branches, read once by `<RegistrationConversion/>`. Attribution is the
 * same mechanism with a longer window: a cookie written on the marketing shell,
 * read in `addAgency()`, merged into the EXISTING `registration_completed.props`
 * jsonb. No column, no table, no migration — `do-not-touch.md` §2 stays intact.
 *
 * This module is pure. It parses, sanitises and serialises; it touches no
 * cookie, no DOM and no database, so both the client writer and the server
 * reader share one definition and cannot drift.
 */

/** Cookie name. Mirrors `scrm_reg`'s naming so the pair is recognisable. */
export const ATTRIBUTION_COOKIE = 'scrm_attr'

/**
 * 30 days. Long enough that a user who taps an ad, leaves, and comes back a
 * week later to register is still attributed to the ad that acquired them —
 * which is the entire question this exists to answer. `scrm_reg` is 10 minutes
 * because it is a single-redirect handoff; this is an acquisition window and
 * they are not the same kind of value.
 */
export const ATTRIBUTION_MAX_AGE_S = 60 * 60 * 24 * 30

/**
 * The complete allowlist. Anything not named here is dropped rather than
 * stored: this value is written from the client, ends up in a jsonb column, and
 * an open-ended bag would let a crafted landing URL put arbitrary keys into
 * analytics. `referrer` is the one derived key — see `readAttributionFromUrl`.
 */
const KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'referrer',
] as const

export type AttributionKey = (typeof KEYS)[number]
export type Attribution = Partial<Record<AttributionKey, string>>

/** Per-value cap. Real utm values are short; anything longer is noise or abuse. */
const MAX_VALUE_LEN = 200

/**
 * Keys whose presence means "this visit came from a campaign click". Used to
 * decide whether a later visit may overwrite an earlier one — see
 * `shouldOverwriteAttribution`.
 */
const AD_KEYS: AttributionKey[] = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid']

function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  // Control characters would survive JSON and land in a jsonb value that no
  // query expects; strip them rather than reject the whole attribution.
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, MAX_VALUE_LEN)
}

/**
 * Build an attribution from a landing URL's query string plus the referrer.
 *
 * `referrer` is reduced to its HOSTNAME on purpose. A full referrer URL can
 * carry a path and query belonging to another site — someone else's data, of no
 * analytical use to us, in a field we would then be storing indefinitely. The
 * host is what answers the question ("facebook.com", "google.com", "instagram.com");
 * the rest is a liability. Same-origin referrers are dropped entirely, since an
 * internal navigation attributes nothing.
 */
export function readAttributionFromUrl(search: string, referrer: string, currentHost: string): Attribution {
  const out: Attribution = {}
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return out
  }

  for (const key of KEYS) {
    if (key === 'referrer') continue
    const value = clean(params.get(key))
    if (value) out[key] = value
  }

  const host = referrerHost(referrer)
  if (host && host !== currentHost) out.referrer = host

  return out
}

function referrerHost(referrer: string): string | undefined {
  if (!referrer) return undefined
  try {
    return clean(new URL(referrer).hostname)
  } catch {
    return undefined
  }
}

/** True when the attribution carries at least one real signal worth storing. */
export function hasAttribution(attr: Attribution): boolean {
  return Object.keys(attr).length > 0
}

/**
 * Whether a NEW visit's attribution should replace one already stored.
 *
 * First touch wins by default — the campaign that acquired someone is the one
 * that should get credit, not whatever tab they happened to register from.
 * The single exception is a fresh CAMPAIGN CLICK: if someone lands organically,
 * leaves, then clicks an ad and registers, the ad genuinely acquired that
 * signup and overwriting is correct. An organic visit never overwrites an ad.
 */
export function shouldOverwriteAttribution(existing: Attribution | null, incoming: Attribution): boolean {
  if (!existing || !hasAttribution(existing)) return hasAttribution(incoming)
  return AD_KEYS.some((k) => incoming[k] !== undefined)
}

export function serializeAttribution(attr: Attribution): string {
  return JSON.stringify(attr)
}

/**
 * Parse a stored cookie value back into an attribution.
 *
 * Everything here is defensive: the input is a cookie, so it may be truncated,
 * hand-edited, or left over from an older shape. Any failure yields `null` and
 * the caller records a registration with no attribution — which is exactly the
 * behaviour before this feature, never an error.
 */
export function parseAttribution(raw: string | null | undefined): Attribution | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const source = parsed as Record<string, unknown>
  const out: Attribution = {}
  for (const key of KEYS) {
    const value = clean(typeof source[key] === 'string' ? (source[key] as string) : undefined)
    if (value) out[key] = value
  }
  return hasAttribution(out) ? out : null
}
