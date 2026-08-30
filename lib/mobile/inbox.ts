import 'server-only'
import type { InboxConversationListItem, InboxCursor } from '@/modules/inbox/types'

/**
 * Projection and cursor encoding for the mobile inbox.
 *
 * Shared by the list and the single-conversation endpoints so the two cannot
 * describe the same conversation differently — a thread header that disagreed
 * with the row the rep tapped would look like a bug in the data.
 */

/**
 * The list cursor, as an opaque string.
 *
 * The server's `InboxCursor` is an object of `(lastMessageAt, id, unread, rank)`
 * — a keyset, not an offset. Mobile clients model a cursor as a STRING they
 * echo back, so it is encoded rather than exposed field by field. Opaqueness is
 * the point: the client cannot construct one, only return one it was given, so
 * the pagination predicate is never driven by client-authored values.
 *
 * This is NOT a security boundary — the values are unprivileged and every query
 * is agency-scoped regardless. It is a shape and stability boundary.
 */
export function encodeInboxCursor(cursor: InboxCursor | null): string | null {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * Decodes a cursor, returning `null` for anything malformed.
 *
 * Every field is re-validated: a tampered blob must produce a rejected request,
 * never a partially-typed object that reaches a SQL predicate.
 */
export function decodeInboxCursor(raw: string | null): InboxCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>

    const lastMessageAt = parsed.lastMessageAt
    const id = Number(parsed.id)
    if (typeof lastMessageAt !== 'string' || Number.isNaN(Date.parse(lastMessageAt))) return null
    if (!Number.isInteger(id) || id < 1) return null

    const rank = parsed.rank === undefined ? undefined : Number(parsed.rank)
    if (rank !== undefined && !Number.isFinite(rank)) return null

    return {
      lastMessageAt,
      id,
      unread: parsed.unread === true,
      ...(rank === undefined ? {} : { rank }),
    }
  } catch {
    return null
  }
}

/**
 * Conversation → mobile DTO.
 *
 * An ALLOW-LIST. The source row carries `agencyId` and internal bookkeeping the
 * device has no use for, and a spread would ship whatever the inbox adds next.
 *
 * Dropped deliberately, though present on the server item:
 *   · `lastInboundAt` / `lastHumanOutboundAt` — inputs to `attention` and
 *     `unread`, both already resolved server-side. Sending the raw timestamps
 *     invites the client to recompute a verdict it must not own.
 *   · `waitingTitle` / `waitingWindowHint` — desktop-only presentation strings.
 */
export function toMobileConversation(item: InboxConversationListItem) {
  return {
    conversationId: item.conversationId,
    leadId: item.leadId,
    // The client contract is WhatsApp-only and rejects anything else.
    channel: item.channel,
    displayName: item.displayName,
    leadName: item.leadName,
    leadStatus: item.leadStatus,
    lastMessageAt: item.lastMessageAt,
    lastDirection: item.lastDirection,
    lastMessagePreview: item.lastMessagePreview,
    // Per-user, resolved server-side. Never derivable on the device.
    unread: item.unread,
    attention: item.attention,
    temperature: item.temperature,
    intent: item.intent,
    suggestedAction: item.suggestedAction,
  }
}

/**
 * ⚠️ `toMobileMessage` DELIBERATELY OMITTED FROM THIS RELEASE.
 *
 * Its only caller was `GET /inbox/conversations/[id]/messages`, which ships in a
 * later release together with the `db/inboxMessages.ts` work that adds
 * `sentByUserId` to `LeadWhatsappMessage`. Carrying a projection here with no
 * caller — and no field to project — would be dead code that fails to compile.
 * It returns with the route it serves.
 */
