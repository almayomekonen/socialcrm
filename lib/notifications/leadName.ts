/**
 * The lead's display name for notification copy.
 *
 * Same rule as `db/automations/leadFacts.ts` — first and last name joined, or
 * null. Extracted because five emission sites need it and each already holds the
 * lead row: passing the name along costs nothing, while resolving it in the
 * worker would be a query per notification.
 *
 * Returns null rather than a placeholder when there is no name. The copy layer
 * then omits the name entirely instead of rendering something invented
 * (care-charter Law 1).
 */
export function leadDisplayName(row: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null {
  if (!row) return null
  return [row.firstName, row.lastName].filter(Boolean).join(' ') || null
}
