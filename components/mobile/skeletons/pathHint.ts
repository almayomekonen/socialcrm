import { headers } from 'next/headers'

/**
 * Best-effort request path for choosing a loading skeleton.
 *
 * Route `loading.tsx` files do not receive `searchParams`. The layout Suspense
 * fallback cannot await `getUser()`. Headers are the only signal available at
 * the moment a phone would otherwise receive the desktop spinner or a
 * Today-shaped chrome on `/leads`.
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
