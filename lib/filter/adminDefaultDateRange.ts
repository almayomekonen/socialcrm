import { isAdmin, type Roles } from '@/types/roles'

/**
 * The date range an admin's sales filter gets when it names none.
 *
 * Mirrors `getPermsAndFilter` (db/filter.ts): an admin whose filter has no
 * `dateRange` is served the current month on עסקאות and ביצועים. That default is
 * added on the server, after the URL is read, so the chips — which read the URL —
 * never showed it and admins saw a filtered table with no visible filter.
 * Keep the two in step; the server one is the behavior, this one only shows it.
 */
export const ADMIN_DEFAULT_DATE_RANGE = 'החודש הנוכחי'
export const ALL_DATES = 'כל התאריכים'

/** The filter as the server applies it: the admin default included. */
export function withAdminDefaultDateRange<T extends { dateRange?: string; [key: string]: unknown }>(filter: T, role: Roles | undefined): T {
  if (!role || !isAdmin(role) || filter?.dateRange) return filter
  return { ...filter, dateRange: ADMIN_DEFAULT_DATE_RANGE }
}

/**
 * The filter after removing its date range. Plain removal would let the server
 * re-apply the current month for an admin, so the chip's ✕ would do nothing;
 * an admin gets an explicit "all dates" instead.
 */
export function withoutDateRange<T extends { dateRange?: string; start?: string; end?: string; [key: string]: unknown }>(
  filter: T,
  role: Roles | undefined,
): T {
  const next = { ...filter }
  delete next.dateRange
  delete next.start
  delete next.end
  if (role && isAdmin(role)) next.dateRange = ALL_DATES
  return next
}
