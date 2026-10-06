/**
 * The ACTIVE filter of a filtered section (ביצועים, עסקאות), remembered per
 * user, per section and per browser.
 *
 * The URL (`?filter=<json>`) stays the source of truth: a refresh with the query
 * string already keeps the filter. What lost it was opening the section WITHOUT
 * the query string — the sidebar link, a redirect such as the one after saving a
 * deal, a typed URL, a new tab. So the last applied filter string is also kept
 * in a cookie, and a page opened without `?filter=` falls back to it
 * (server-side, so the first render is already filtered).
 *
 * Precedence: explicit URL filter > remembered section filter > section default.
 *
 * Not the same thing as saved filters (`users.savedFilters`): those are named
 * and deliberate; this is only "what I was looking at".
 *
 * Only the user's own filter selection is stored — never results or agency
 * data. The cookie name carries the section and the user id, so sections never
 * overwrite each other and another user in the same browser never reads it.
 */

export type FilterSection = 'performance' | 'deals'

const SECTIONS: Record<FilterSection, { cookiePrefix: string; matches: (pathname: string) => boolean }> = {
  // Cookie name unchanged from the Performance-only version, so filters users
  // already have remembered keep working. The ads report does not use the sales filter.
  performance: {
    cookiePrefix: 'sum_sales_filter_',
    matches: (p) => (p === '/sum_sales' || p.startsWith('/sum_sales/')) && p !== '/sum_sales/ads',
  },
  deals: { cookiePrefix: 'deals_filter_', matches: (p) => p === '/deals' },
}

/** Stay well inside the ~4KB per-cookie limit; a longer filter is just not remembered. */
const MAX_LENGTH = 3500
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365
/**
 * Path=/ on purpose. Scoping it to the section path was tried: after a client
 * navigation from another page the restore effect can run while
 * document.location is still that page, where a path-scoped cookie is
 * invisible — the URL then never synced and reset hit a stale cached page.
 */
const COOKIE_PATH = '/'

export function activeFilterCookie(section: FilterSection, userId: number | string): string {
  return `${SECTIONS[section].cookiePrefix}${userId}`
}

/** Which remembered-filter section a path belongs to, if any. */
export function filterSectionForPath(pathname: string | null | undefined): FilterSection | null {
  if (!pathname) return null
  for (const section of Object.keys(SECTIONS) as FilterSection[]) {
    if (SECTIONS[section].matches(pathname)) return section
  }
  return null
}

/**
 * A stored value is used only when it is a JSON object (what the filter panel
 * writes). Anything else — empty, truncated, tampered, stale shape — is ignored,
 * and the page falls back to its normal defaults.
 */
export function parsePersistedFilter(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null
  for (const candidate of [raw, safeDecode(raw)]) {
    if (!candidate) continue
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return candidate
    } catch {
      /* try the next form */
    }
  }
  return null
}

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

// ── Browser side ─────────────────────────────────────────────────────────────

export function readPersistedFilter(section: FilterSection, userId: number | string): string | null {
  if (typeof document === 'undefined') return null
  const name = activeFilterCookie(section, userId) + '='
  const entry = document.cookie.split('; ').find((c) => c.startsWith(name))
  return parsePersistedFilter(entry?.slice(name.length))
}

export function persistFilter(section: FilterSection, userId: number | string, filter: string): void {
  if (typeof document === 'undefined' || !parsePersistedFilter(filter)) return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${activeFilterCookie(section, userId)}=${encodeURIComponent(filter)}; Path=${COOKIE_PATH}; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

export function clearPersistedFilter(section: FilterSection, userId: number | string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${activeFilterCookie(section, userId)}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=Lax`
}
