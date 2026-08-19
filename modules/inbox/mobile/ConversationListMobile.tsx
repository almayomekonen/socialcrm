import type { InboxConversationListItem, InboxCursor } from '@/modules/inbox/types'
import ConversationListMobileClient from './ConversationListMobileClient'

/**
 * שיחות — the mobile conversation list.
 *
 * A messaging app's list, not the desktop inbox's three-pane workspace: one row
 * per conversation, name + last message + when + unread, and the whole row opens
 * the thread. Long press enters selection; delete / mark-as-read reuse the
 * existing per-id mutations.
 *
 * Server Component wrapper: timestamps are formatted here against one `nowMs`
 * (architecture-rules.md §11). Interaction lives in the client island.
 */
export default function ConversationListMobile({
  items,
  q,
  nextCursor,
  formatWhen,
}: {
  items: InboxConversationListItem[]
  q: string
  nextCursor?: InboxCursor | null
  /** Server-computed relative time, e.g. "לפני 4 דקות". */
  formatWhen: (iso: string | null) => string
}) {
  const rows = items.map((c) => ({ ...c, when: formatWhen(c.lastMessageAt) }))
  return <ConversationListMobileClient items={rows} q={q} nextCursor={nextCursor ?? null} />
}
