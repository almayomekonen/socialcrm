import { headers } from 'next/headers'

/**
 * Best-effort request path for choosing a COLD chrome skeleton.
 *
 * Do not call this from `loading.tsx`. Awaiting headers there is the
 * stuck-skeleton client-navigation failure under cacheComponents.
 * Destination-shaped route fallbacks now use the mounted shell + `usePathname`.
 *
 * `next-url` is set on client navigations. A cold document request may only
 * expose `referer`. Empty string → caller uses its default (Today chrome).
 */
export async function requestPathHint(): Promise<string> {
  const h = await headers()
  const raw =
    h.get('x-socialcrm-path') ||
    h.get('next-url') ||
    h.get('x-url') ||
    h.get('x-invoke-path') ||
    h.get('x-matched-path') ||
    h.get('referer') ||
    ''
  if (!raw) return ''
  try {
    if (raw.startsWith('/')) return raw
    return `${new URL(raw).pathname}${new URL(raw).search}`
  } catch {
    return raw
  }
}
