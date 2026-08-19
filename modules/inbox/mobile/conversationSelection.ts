import type { InboxConversationListItem } from '@/modules/inbox/types'

/** View model: server-stamped relative time, never computed per render. */
export type ConversationListRow = InboxConversationListItem & { when: string }

export function selectedUnreadIds(items: ConversationListRow[], selected: ReadonlySet<number>): number[] {
  const ids: number[] = []
  for (const row of items) {
    if (selected.has(row.conversationId) && row.unread) ids.push(row.conversationId)
  }
  return ids
}

export function removeSelectedRows(
  items: ConversationListRow[],
  ids: ReadonlySet<number>,
): ConversationListRow[] {
  if (ids.size === 0) return items
  return items.filter((row) => !ids.has(row.conversationId))
}

/**
 * Put failed deletes back where they were. Snapshot order is the source of
 * truth; rows that arrived after the snapshot (load-more) stay at the end.
 */
export function restoreRows(
  current: ConversationListRow[],
  snapshot: ConversationListRow[],
  ids: ReadonlySet<number>,
): ConversationListRow[] {
  if (ids.size === 0) return current
  const byId = new Map<number, ConversationListRow>()
  for (const row of current) byId.set(row.conversationId, row)
  for (const row of snapshot) {
    if (ids.has(row.conversationId)) byId.set(row.conversationId, row)
  }
  const seen = new Set<number>()
  const out: ConversationListRow[] = []
  for (const row of snapshot) {
    const next = byId.get(row.conversationId)
    if (!next) continue
    out.push(next)
    seen.add(row.conversationId)
  }
  for (const row of current) {
    if (!seen.has(row.conversationId)) out.push(row)
  }
  return out
}

export function markRowsRead(
  items: ConversationListRow[],
  ids: ReadonlySet<number>,
): ConversationListRow[] {
  if (ids.size === 0) return items
  return items.map((row) => (ids.has(row.conversationId) && row.unread ? { ...row, unread: false } : row))
}

export function restoreUnread(
  items: ConversationListRow[],
  snapshot: ConversationListRow[],
  ids: ReadonlySet<number>,
): ConversationListRow[] {
  if (ids.size === 0) return items
  const unread = new Set(snapshot.filter((row) => ids.has(row.conversationId) && row.unread).map((row) => row.conversationId))
  if (unread.size === 0) return items
  return items.map((row) => (unread.has(row.conversationId) ? { ...row, unread: true } : row))
}
