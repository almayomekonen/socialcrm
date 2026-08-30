/**
 * The URL-derived scope of the desktop lead / client list.
 *
 * WHY THIS EXISTS. The toolbar search writes `?q=`, and both the server query
 * (`db/clients.getLeadsTable`) and the table shell (`clientsTable`) have to
 * agree on one question: is this list narrowed right now, and by what? They used
 * to answer it separately and disagree, which is how a search could end with the
 * first-run "אין עדיין לידים" screen in front of a rep holding hundreds of leads.
 *
 * One module owns the parameter names and the parsing. PURE: no I/O, no
 * framework, no clock — trivially unit-testable, and importable from a Server
 * Component and a Client Component alike.
 *
 * This is NOT a second filter vocabulary. `modules/leads/filters.ts` owns the
 * `q` / `status` contract and its validation; the two list pages parse `q`
 * through it before handing it to the query. This module owns the desktop
 * table's URL bookkeeping — what counts as "narrowed", and how to clear it.
 */

/** `client_lists.id` is a PostgreSQL `integer` column. */
const PG_INT_MAX = 2_147_483_647

/**
 * The querystring keys that narrow the desktop list to less than "everything".
 *
 * `q` is the search the toolbar writes. `listId` and `view` are the pre-existing
 * narrowings (a saved list, and the dashboard's follow-up view). `clientId` is
 * deliberately absent — the desktop search no longer builds a single-lead
 * workspace, and nothing writes it any more.
 */
export const LEAD_SCOPE_PARAMS = ['q', 'listId', 'view'] as const

/** Raw `searchParams`-shaped input: values may arrive repeated. */
export type RawScopeParams = Record<string, string | string[] | undefined | null>

function firstValue(v: string | string[] | undefined | null): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/**
 * Parse an untrusted id parameter into a usable `integer`, or null.
 *
 * `client_lists.id` is `integer`, so a non-numeric value reaching the query is
 * not a "no results" case — it is `22P02 invalid input syntax for type integer`,
 * which aborts the page render and replaces the whole workspace with the segment
 * error boundary. Anything that is not a plain positive in-range integer is
 * reported as absent so the caller can fall back to unscoped behaviour.
 *
 * Deliberately strict: `Number()` would happily accept `' 12 '`, `'12e3'`,
 * `'0x0c'` and `'Infinity'`, none of which are ids a link of ours ever produces.
 */
export function parseListId(raw: string | string[] | undefined | null): number | null {
  const s = firstValue(raw).trim()
  if (!/^[0-9]+$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= PG_INT_MAX ? n : null
}

/**
 * The same parser, named for what the mobile API actually parses: a LEAD id from
 * a path segment, not a list id from a query string.
 *
 * An alias rather than a copy, deliberately. The validation that matters here is
 * the strictness above — rejecting `' 12 '`, `'12e3'`, `'0x0c'` and `'Infinity'`
 * so a malformed path cannot reach Postgres as `22P02`. Two implementations
 * would eventually disagree about which of those is an id, and the mobile route
 * would be the one that stopped rejecting them.
 */
export const parseLeadId = parseListId

/** The active search term, or `''`. Length is capped server-side by `parseLeadFilters`. */
export function parseLeadSearch(params: RawScopeParams | null | undefined): string {
  if (!params) return ''
  return firstValue(params.q).trim()
}

/**
 * Is the list currently narrowed by anything the user can clear?
 *
 * The one question the empty state has to get right: zero rows under an active
 * scope means "this search matched nothing", never "you have no לידים".
 */
export function hasActiveLeadScope(params: RawScopeParams | null | undefined): boolean {
  if (!params) return false
  return parseLeadSearch(params).length > 0 || parseListId(params.listId) !== null || firstValue(params.view).length > 0
}

/**
 * Apply a search term to a querystring, preserving everything else.
 *
 * `pageNum` is dropped because the offset it carries belongs to a different,
 * wider result set. `clientId` / `clientDetails` are dropped as legacy cleanup:
 * nothing writes them any more, and a bookmarked one would otherwise ride along
 * forever. An empty term removes the search.
 */
export function withLeadSearch(current: URLSearchParams, term: string): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  const q = term.trim()
  if (q) next.set('q', q)
  else next.delete('q')
  next.delete('pageNum')
  next.delete('clientId')
  next.delete('clientDetails')
  return next
}

/** Clear the search, leaving every other narrowing (saved list, view) in place. */
export function clearLeadSearchParams(current: URLSearchParams): URLSearchParams {
  return withLeadSearch(current, '')
}

/**
 * Strip EVERY narrowing — the "show me all my לידים" escape hatch behind the
 * empty state's one button.
 *
 * Wider than `clearLeadSearchParams` on purpose. Clearing the search box clears
 * the search and nothing else; pressing "show everything" on an empty screen has
 * to also lift a saved list or a `view=due` arrival, or the button is a control
 * that visibly does nothing.
 */
export function clearLeadScopeParams(current: URLSearchParams): URLSearchParams {
  const next = clearLeadSearchParams(current)
  for (const key of LEAD_SCOPE_PARAMS) next.delete(key)
  return next
}
