import type { InboxIntelFilter, InboxListFilters, InboxSort, InboxStatusFilter } from './types'
import { DEFAULT_INBOX_FILTERS } from './types'

const STATUSES: InboxStatusFilter[] = ['all', 'open', 'closed', 'archived']
const SORTS: InboxSort[] = ['latest', 'oldest', 'unread', 'temperature', 'intent', 'action']
const INTEL_FILTERS: InboxIntelFilter[] = ['all', 'hot', 'attention', 'pricing', 'demo', 'support', 'escalation', 'followup']

type RawParams = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

export function parseInboxFilters(params: RawParams): InboxListFilters {
  const status = first(params.status)
  const sort = first(params.sort)
  const intel = first(params.intel)
  const q = first(params.q)?.trim()

  return {
    q: q ? q : null,
    status: STATUSES.includes(status as InboxStatusFilter) ? (status as InboxStatusFilter) : 'all',
    unread: first(params.unread) === '1',
    needsReply: first(params.needsReply) === '1',
    intel: INTEL_FILTERS.includes(intel as InboxIntelFilter) ? (intel as InboxIntelFilter) : 'all',
    sort: SORTS.includes(sort as InboxSort) ? (sort as InboxSort) : 'latest',
  }
}

export function inboxFiltersToSearchParams(
  filters: InboxListFilters,
  opts: { conversation?: number | null } = {},
): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.q) sp.set('q', filters.q)
  if (filters.status !== DEFAULT_INBOX_FILTERS.status) sp.set('status', filters.status)
  if (filters.unread) sp.set('unread', '1')
  if (filters.needsReply) sp.set('needsReply', '1')
  if (filters.intel !== DEFAULT_INBOX_FILTERS.intel) sp.set('intel', filters.intel)
  if (filters.sort !== DEFAULT_INBOX_FILTERS.sort) sp.set('sort', filters.sort)
  if (opts.conversation) sp.set('conversation', String(opts.conversation))
  return sp
}

export function inboxFiltersKey(filters: InboxListFilters): string {
  return inboxFiltersToSearchParams(filters).toString()
}

export function hasActiveInboxFilters(filters: InboxListFilters): boolean {
  return (
    !!filters.q ||
    filters.status !== DEFAULT_INBOX_FILTERS.status ||
    filters.unread ||
    filters.needsReply ||
    filters.intel !== DEFAULT_INBOX_FILTERS.intel ||
    filters.sort !== DEFAULT_INBOX_FILTERS.sort
  )
}
