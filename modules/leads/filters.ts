import type { LeadStatus } from '@/lib/calendar/outcomeStatusSuggestion'

/**
 * URL-backed lead filter state — the single vocabulary for both presentations.
 *
 * WHY THE URL. The desktop table keeps tabs, sort and columns in twelve
 * `useState`s, which means refresh, back/forward, deep links and sharing all
 * lose the view. The mobile quality bar requires every one of those to work, so
 * mobile filter state lives in the querystring and nowhere else. This module is
 * the only place that knows the parameter names.
 *
 * NOT a second filter vocabulary. The statuses below are pinned to the existing
 * `LeadStatus` union by an exhaustive `Record`, so adding or renaming a status
 * upstream fails THIS file's build rather than silently leaving mobile filtering
 * a status behind. The Hebrew labels are not duplicated here — they stay in
 * `STATUS_STYLES`, which the client components import directly.
 *
 * (`STATUS_STYLES` itself is deliberately NOT imported here: it lives in a
 * `'use client'` module, and pulling it into shared server code would drag a
 * client boundary into every server caller of this file.)
 *
 * Desktop is untouched — it does not read these params today and this module
 * does not make it start. See `queries.ts` for why the filters travel as an
 * explicit argument rather than inside the raw `searchParams` object.
 *
 * PURE: no I/O, no framework, no clock. Trivially unit-testable.
 */

/**
 * `new | contacted | interested | closed | lost`.
 *
 * The `Record<LeadStatus, true>` is a compile-time exhaustiveness check: if the
 * union in `lib/calendar/outcomeStatusSuggestion.ts` gains a member, this object
 * stops type-checking and the build fails here — which is the point. A plain
 * string array would have gone quietly stale.
 */
const STATUS_VOCABULARY: Record<LeadStatus, true> = {
  new: true,
  contacted: true,
  interested: true,
  closed: true,
  lost: true,
}

export const LEAD_STATUSES = Object.keys(STATUS_VOCABULARY) as LeadStatus[]

export type LeadFilters = {
  /** Free-text search over name / phone / email. Empty string means "no search". */
  q: string
  /** Selected statuses. Empty array means "all statuses". */
  status: LeadStatus[]
}

export const EMPTY_FILTERS: LeadFilters = { q: '', status: [] }

/** The exact query parameters this module owns. Documented for the report. */
export const LEAD_FILTER_PARAMS = ['q', 'status'] as const

type RawParams = Record<string, string | string[] | undefined>

function firstValue(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/**
 * Parse untrusted querystring input into a validated filter object.
 *
 * Every value is checked against a fixed vocabulary — an unknown status is
 * dropped rather than passed to SQL. `q` is length-capped: it reaches a `LIKE`
 * pattern, and an unbounded user string on a hot query path is a cheap way to
 * make the database do expensive work.
 */
export function parseLeadFilters(params: RawParams | undefined | null): LeadFilters {
  if (!params) return EMPTY_FILTERS

  const q = firstValue(params.q).trim().slice(0, 100)

  const rawStatus = params.status
  const statusList = Array.isArray(rawStatus) ? rawStatus : rawStatus ? rawStatus.split(',') : []
  const status = (statusList.map((s) => s.trim()) as LeadStatus[])
    .filter((s) => LEAD_STATUSES.includes(s))
    // De-duplicate so `?status=new&status=new` cannot widen the IN clause.
    .filter((s, i, arr) => arr.indexOf(s) === i)

  return { q, status }
}

/**
 * Serialize filters back to a querystring, omitting defaults.
 *
 * Omitting empties keeps shared URLs short and, more importantly, keeps "no
 * filters" a single canonical URL rather than `?q=&status=` — otherwise back/
 * forward accumulates history entries that all render the same screen.
 */
export function serializeLeadFilters(filters: LeadFilters): string {
  const sp = new URLSearchParams()
  if (filters.q) sp.set('q', filters.q)
  if (filters.status.length) sp.set('status', filters.status.join(','))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Href for the leads route with these filters applied. */
export function leadsHref(filters: LeadFilters): string {
  return `/leads${serializeLeadFilters(filters)}`
}

export function hasActiveFilters(filters: LeadFilters): boolean {
  return filters.q.length > 0 || filters.status.length > 0
}

/** Stable key for caching/memoization and for React `key` on filter changes. */
export function leadFiltersKey(filters: LeadFilters): string {
  return `${filters.q}|${[...filters.status].sort().join(',')}`
}
