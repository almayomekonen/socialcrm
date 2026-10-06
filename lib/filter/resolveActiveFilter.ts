import { cookies } from 'next/headers'
import { activeFilterCookie, parsePersistedFilter, type FilterSection } from './activeFilter'

/**
 * The filter a section's page renders with: the URL's `?filter=` when present,
 * otherwise this user's remembered filter for THAT section (see
 * `activeFilter.ts`), otherwise undefined — the section's normal defaults.
 */
export async function resolveActiveFilter(
  section: FilterSection,
  userId: number | undefined,
  urlFilter: string | undefined,
): Promise<string | undefined> {
  if (urlFilter) return urlFilter
  if (!userId) return undefined
  const stored = (await cookies()).get(activeFilterCookie(section, userId))?.value
  return parsePersistedFilter(stored) ?? undefined
}
