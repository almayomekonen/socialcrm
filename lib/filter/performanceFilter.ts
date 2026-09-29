/**
 * The ACTIVE Performance (ביצועים) filter, remembered per user and browser.
 *
 * The URL (`?filter=<json>`) stays the source of truth: a refresh with the query
 * string already keeps the filter. What lost it was opening a Performance page
 * WITHOUT the query string — the sidebar link, a typed URL, a new tab. So the
 * last applied filter string is also kept in a cookie, and a Performance page
 * opened without `?filter=` falls back to it (server-side, so the first render
 * is already filtered).
 *
 * Not the same thing as saved filters (`users.savedFilters`): those are named
 * and deliberate; this is only "what I was looking at".
 *
 * Only the user's own filter selection is stored — never results or agency
 * data. The cookie name carries the user id, so another user in the same
 * browser never reads it.
 */

const COOKIE_PREFIX = 'sum_sales_filter_'
/** Stay well inside the ~4KB per-cookie limit; a longer filter is just not remembered. */
const MAX_LENGTH = 3500
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365
/**
 * Path=/ on purpose. Scoping it to /sum_sales was tried: after a client
 * navigation from another page the restore effect can run while
 * document.location is still that page, where a /sum_sales-scoped cookie is
 * invisible — the URL then never synced and reset hit a stale cached page.
 */
const COOKIE_PATH = '/'

export function performanceFilterCookie(userId: number | string): string {
  return `${COOKIE_PREFIX}${userId}`
}

/** Pages whose filter is remembered. The ads report does not use the sales filter. */
export function isPerformanceFilterPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return (pathname === '/sum_sales' || pathname.startsWith('/sum_sales/')) && pathname !== '/sum_sales/ads'
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

export function readPersistedFilter(userId: number | string): string | null {
  if (typeof document === 'undefined') return null
  const name = performanceFilterCookie(userId) + '='
  const entry = document.cookie.split('; ').find((c) => c.startsWith(name))
  return parsePersistedFilter(entry?.slice(name.length))
}

export function persistFilter(userId: number | string, filter: string): void {
  if (typeof document === 'undefined' || !parsePersistedFilter(filter)) return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${performanceFilterCookie(userId)}=${encodeURIComponent(filter)}; Path=${COOKIE_PATH}; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

export function clearPersistedFilter(userId: number | string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${performanceFilterCookie(userId)}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=Lax`
}
