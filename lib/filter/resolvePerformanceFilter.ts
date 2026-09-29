import { cookies } from 'next/headers'
import { parsePersistedFilter, performanceFilterCookie } from './performanceFilter'

/**
 * The filter a Performance page renders with: the URL's `?filter=` when present,
 * otherwise this user's remembered active filter (see `performanceFilter.ts`),
 * otherwise undefined — the page's normal defaults.
 */
export async function resolvePerformanceFilter(
  userId: number | undefined,
  urlFilter: string | undefined,
): Promise<string | undefined> {
  if (urlFilter) return urlFilter
  if (!userId) return undefined
  const stored = (await cookies()).get(performanceFilterCookie(userId))?.value
  return parsePersistedFilter(stored) ?? undefined
}
