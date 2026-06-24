import type { InboxConversationListItem } from './types'

/**
 * Merge the server-refreshed first page with locally-accumulated "load more"
 * pages, deduped by conversationId. The first page wins on conflict, so a
 * conversation that moved into the (live) first page replaces any stale copy
 * held in the pagination overlay. Pure — unit-testable, no React.
 */
export function mergeConversationPages(
  firstPage: InboxConversationListItem[],
  extra: InboxConversationListItem[],
): InboxConversationListItem[] {
  const seen = new Set(firstPage.map((i) => i.conversationId))
  return [...firstPage, ...extra.filter((i) => !seen.has(i.conversationId))]
}
