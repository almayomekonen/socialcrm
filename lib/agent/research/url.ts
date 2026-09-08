/**
 * Canonical form of a source URL, for DEDUPLICATION ONLY. Pure and total.
 *
 * WHY IT EXISTS. Measured in Phase 4a: one run returned six source records over
 * three distinct pages, and one of those URLs carried `?utm_source=openai` — the
 * provider's own attribution parameter. Deduping on the raw string therefore
 * counts one page twice, and two refs pointing at one page let a claim look
 * twice-supported by citing both.
 *
 * IT IS NEVER WHAT WE CITE. The evidence ref keeps the provider's original URL
 * verbatim, because that is the address the provider actually fetched and the
 * one a reader must be able to open. A rewritten URL in a citation is a citation
 * to a page nobody visited. Canonical form exists to answer "is this the same
 * page?" and is thrown away immediately afterwards.
 *
 * CONSERVATIVE BY CONSTRUCTION. Every rule below is deterministic, reversible in
 * meaning, and safe for a page's identity. Rules that would be more effective and
 * less safe — stripping `index.html`, collapsing locale prefixes, following
 * redirects, dropping arbitrary short query params — are deliberately absent: an
 * over-eager rule silently merges two different pages, and the resulting claim
 * cites the wrong one. Under-merging costs a duplicate source, which the caps
 * already bound; over-merging costs correctness.
 */

/**
 * Query parameters removed before comparison.
 *
 * A CLOSED LIST, not a heuristic. Each is a campaign or click identifier that
 * cannot change which document is served — `utm_*` is the Urchin convention,
 * the rest are the click ids of specific ad platforms. Anything not on this list
 * is preserved, including short opaque params, because on many sites those
 * select the content (`?p=`, `?id=`, `?v=`).
 */
const TRACKING_PARAMS: readonly string[] = [
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'oly_enc_id',
  'oly_anon_id',
]

const isTracking = (key: string): boolean =>
  key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.includes(key.toLowerCase())

/**
 * The canonical string for comparison, or null when the input is not a usable
 * http(s) page address.
 *
 * Returning null is a real answer, not an error case: a `javascript:` or `data:`
 * "source" is not a page anyone read, and the harvest drops it rather than
 * inventing a canonical form for it.
 */
export function canonicalUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const scheme = u.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') return null

  // Host is case-insensitive by spec; the path is not, and is left alone.
  let host = u.hostname.toLowerCase()
  // `www.` is the one host-level equivalence that is safe everywhere: no site
  // serves a different document at `www.` than at its bare host.
  if (host.startsWith('www.')) host = host.slice(4)
  // Default ports are the same endpoint written two ways.
  const port = (scheme === 'http:' && u.port === '80') || (scheme === 'https:' && u.port === '443') ? '' : u.port

  /**
   * Trailing slash is dropped, EXCEPT on the root. `/pricing` and `/pricing/`
   * are the same document in every server convention worth supporting, while `/`
   * and `` are not the same string and the root must keep its slash.
   */
  let path = u.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '')
  if (path === '') path = '/'

  /**
   * Query is filtered and SORTED. Sorting is what makes the form canonical —
   * `?a=1&b=2` and `?b=2&a=1` request the same document — and it is deterministic,
   * which is the property the dedupe depends on.
   */
  const params = [...u.searchParams.entries()].filter(([k]) => !isTracking(k))
  params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
  const query = params.length > 0 ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : ''

  /**
   * The fragment is dropped, because it never reaches the server and cannot
   * change the document — with one exception. `#!` is the hashbang routing
   * convention, where the fragment IS the page; those are kept so two different
   * hashbang routes do not collapse into one.
   */
  const hash = u.hash.startsWith('#!') ? u.hash : ''

  return `${scheme}//${host}${port ? ':' + port : ''}${path}${query}${hash}`
}

/**
 * Publisher identity for grouping and for honest prose ("according to …").
 *
 * Derived from the URL WE WERE GIVEN, never from page content — a page claiming
 * to be someone else is exactly the spoof this avoids. Registrable-domain
 * extraction is deliberately not attempted: it needs the public suffix list to
 * be correct, and `co.uk` / `com.au` style suffixes make a naive "last two
 * labels" rule wrong in a way that would silently merge unrelated publishers.
 */
export function domainOf(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}
