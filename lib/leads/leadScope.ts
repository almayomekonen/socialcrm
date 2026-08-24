/**
 * The URL-derived scope of the desktop lead / client list.
 *
 * WHY THIS EXISTS. `?clientId=…` is written by the toolbar search when a rep
 * picks a lead from the autocomplete, and it is read again by the server query
 * (`db/clients.getLeadsTable`) and by the table shell (`clientsTable`). Both
 * sides used to derive their own answer to "is a specific lead being requested,
 * and is any scope active at all?" — and disagreed, which is how a search could
 * end with the first-run "אין עדיין לידים" screen in front of a rep holding
 * hundreds of leads.
 *
 * One module owns the parameter names and the parsing. PURE: no I/O, no
 * framework, no clock — trivially unit-testable, and importable from a Server
 * Component and a Client Component alike.
 *
 * This is NOT a second filter vocabulary. `modules/leads/filters.ts` owns the
 * mobile `q`/`status` contract; this owns the desktop table's pre-existing
 * `clientId` / `listId` / `view` params. Neither invents parameters.
 */

/** `clients.id` and `client_lists.id` are PostgreSQL `integer` columns. */
const PG_INT_MAX = 2_147_483_647

/**
 * The querystring keys that scope the desktop list to less than "everything".
 *
 * Exactly the ones `getLeadsTable` honours out of `params` — no more. `q` is
 * deliberately absent: it is the MOBILE filter contract (`modules/leads/filters`),
 * and desktop never reads it, so counting it here would claim a narrowing the
 * desktop query does not apply.
 */
export const LEAD_SCOPE_PARAMS = ['clientId', 'listId', 'view'] as const

/** Raw `searchParams`-shaped input: values may arrive repeated. */
export type RawScopeParams = Record<string, string | string[] | undefined | null>

function firstValue(v: string | string[] | undefined | null): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/**
 * Parse an untrusted id parameter into a usable `integer`, or null.
 *
 * `clients.id` is `integer`, so a non-numeric value reaching the query is not a
 * "no results" case — it is `22P02 invalid input syntax for type integer`, which
 * aborts the page render and replaces the whole workspace with the segment error
 * boundary. Anything that is not a plain positive in-range integer is reported
 * as absent so the caller can fall back to unscoped behaviour.
 *
 * Deliberately strict: `Number()` would happily accept `' 12 '`, `'12e3'`,
 * `'0x0c'` and `'Infinity'`, none of which are ids a link of ours ever produces.
 */
export function parseLeadId(raw: string | string[] | undefined | null): number | null {
  const s = firstValue(raw).trim()
  if (!/^[0-9]+$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= PG_INT_MAX ? n : null
}

/** Same validation, for `?listId=` — `client_lists.id` is also `integer`. */
export const parseListId = parseLeadId

/**
 * Is the list currently narrowed by anything the user can clear?
 *
 * The one question the empty state has to get right: zero rows under an active
 * scope means "this search matched nothing", never "you have no לידים". Only
 * a *valid* `clientId` counts — an unparseable one is ignored by the query, so
 * treating it as an active scope would describe a narrowing that isn't applied.
 */
export function hasActiveLeadScope(params: RawScopeParams | null | undefined): boolean {
  if (!params) return false
  return parseLeadId(params.clientId) !== null || parseListId(params.listId) !== null || firstValue(params.view).length > 0
}

/**
 * Strip the search scope from a querystring, leaving every other parameter
 * alone.
 *
 * `clientDetails` rides along because it is the search box's display text: left
 * behind, it re-populates the input with the name of a lead that is no longer
 * being filtered on. `pageNum` is reset because the offset it carries belongs to
 * a different, narrower result set.
 */
export function clearLeadSearchParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  next.delete('clientId')
  next.delete('clientDetails')
  next.delete('pageNum')
  return next
}

/**
 * Strip EVERY narrowing — the "show me all my לידים" escape hatch behind the
 * empty state's one button.
 *
 * Wider than `clearLeadSearchParams` on purpose. Emptying the search box clears
 * the search and nothing else; pressing "show everything" on an empty screen has
 * to also lift a saved list or a `view=due` arrival, or the button is a control
 * that visibly does nothing.
 */
export function clearLeadScopeParams(current: URLSearchParams): URLSearchParams {
  const next = clearLeadSearchParams(current)
  for (const key of LEAD_SCOPE_PARAMS) next.delete(key)
  return next
}
