import type { InboxListFilters } from '@/modules/inbox/types'

/**
 * Serialize active list filters into query params the /sync endpoint can parse
 * (inverse of parseInboxFilters). Defaults are omitted so the scoped delta matches
 * exactly what the current view shows. Pure — unit-testable.
 */
export function serializeInboxFilters(f: InboxListFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.status && f.status !== 'all') p.set('status', f.status)
  if (f.sort && f.sort !== 'latest') p.set('sort', f.sort)
  if (f.intel && f.intel !== 'all') p.set('intel', f.intel)
  if (f.unread) p.set('unread', '1')
  if (f.needsReply) p.set('needsReply', '1')
  return p
}
