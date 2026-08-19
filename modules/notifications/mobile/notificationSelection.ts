import type { NotificationFeedItem } from '@/modules/notifications/types'

export function selectedUnreadNotificationIds(
  items: NotificationFeedItem[],
  selected: ReadonlySet<number>,
): number[] {
  const ids: number[] = []
  for (const row of items) {
    if (selected.has(row.id) && row.readAt == null) ids.push(row.id)
  }
  return ids
}

export function markNotificationsReadLocal(
  items: NotificationFeedItem[],
  ids: ReadonlySet<number>,
  nowIso: string,
): NotificationFeedItem[] {
  if (ids.size === 0) return items
  return items.map((row) => (ids.has(row.id) && row.readAt == null ? { ...row, readAt: nowIso } : row))
}

export function restoreNotificationUnread(
  items: NotificationFeedItem[],
  snapshot: NotificationFeedItem[],
  ids: ReadonlySet<number>,
): NotificationFeedItem[] {
  if (ids.size === 0) return items
  const unread = new Set(
    snapshot.filter((row) => ids.has(row.id) && row.readAt == null).map((row) => row.id),
  )
  if (unread.size === 0) return items
  return items.map((row) => (unread.has(row.id) ? { ...row, readAt: null } : row))
}
