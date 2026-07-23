import type { InboxMessageStatus } from '@/db/inboxMessages'

/**
 * Outbound WhatsApp delivery ladder.
 *
 * Meta redelivers and reorders `statuses` webhooks routinely, so a transition is
 * never trusted on arrival order — it is evaluated against a monotonic rank.
 *
 * `read` and `failed` deliberately share rank 3: both are terminal, so a read
 * message can never become failed and a failed one can never become read.
 *
 * This mirrors the SQL guard in `ingestWhatsappStatuses.ts` exactly. If one
 * changes, the other must change with it.
 */
export type WhatsappStatusEvent = 'sent' | 'delivered' | 'read' | 'failed'

const RANK: Record<WhatsappStatusEvent, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 3,
}

export function isWhatsappStatusEvent(v: unknown): v is WhatsappStatusEvent {
  return v === 'sent' || v === 'delivered' || v === 'read' || v === 'failed'
}

export function statusRank(s: WhatsappStatusEvent): number {
  return RANK[s]
}

/**
 * Would `next` advance a row currently at `current`?
 *
 * Only `sent` and `delivered` are advanceable. `received` is inbound (and is
 * additionally excluded in SQL by `direction = 'outbound'`); `read` and `failed`
 * are terminal.
 */
export function canTransition(current: InboxMessageStatus, next: WhatsappStatusEvent): boolean {
  if (current !== 'sent' && current !== 'delivered') return false
  return RANK[next] > RANK[current]
}
