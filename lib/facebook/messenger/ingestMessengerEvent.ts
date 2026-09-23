import { db } from '@/config/db'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { echoSource, messengerEventKey, parseMessagingEvent } from '@/lib/facebook/messenger/parseMessagingEvent'
import { bumpMessengerConversation, findOrCreateMessengerConversation, insertMessengerMessage } from '@/db/messenger'
import { applyMessengerWatermark, insertMessengerEvent } from '@/db/messengerEvents'

/**
 * SERVER-INTERNAL — called only from the signature-verified Facebook webhook.
 *
 * TENANCY. The agency is resolved by looking up the verified `entry.id` in
 * `facebook_pages`, and is part of the conversation key — a Page reconnected by
 * another agency starts that agency's own conversations.
 *
 * IDEMPOTENCY. ("pageId", mid) is unique. A redelivery, and the echo of a
 * message SocialCRM itself sent (already stored from the Send API response),
 * both land on an existing row and change nothing — no second message, no
 * second bump.
 *
 * FAILURE. THROWS on a database error; the event worker records the failure on
 * the durable receipt and retries it with backoff.
 */

export type MessengerIngestResult =
  | {
      status: 'stored'
      conversationId: number
      agencyId: number
      direction: 'inbound' | 'outbound'
      /** First message of a new conversation — the one moment a name lookup is worth a Graph call. */
      newConversation: boolean
      /** The stored `messenger_messages.id` — the notification's event identity. */
      messageId: number
      /** When the message was sent (Meta's timestamp), or when it was stored. */
      occurredAt: Date
    }
  | {
      status: 'duplicate'
      /**
       * The already-stored customer message, when the duplicate is one. Lets the
       * worker re-offer its notification: a crash between storing and notifying
       * must not lose it, and the notification's event key makes a second offer a
       * no-op. Absent for echoes of messages the Page sent.
       */
      inbound?: { conversationId: number; agencyId: number; messageId: number; occurredAt: Date; storedAt: Date }
    }
  | {
      /**
       * A delivery/read receipt, postback, referral or reaction: recorded, but
       * never a new message. It must not notify and must not move the 24-hour
       * window — only the customer WRITING does that.
       */
      status: 'signal'
      kind: 'delivery' | 'read' | 'postback' | 'referral' | 'reaction'
      conversationId: number
      agencyId: number
      /** Rows touched (watermark) or 1/0 (event stored / already known). */
      applied: number
    }
  | { status: 'ignored'; reason: string }

export async function ingestMessengerEvent(
  pageId: string,
  raw: unknown,
  opts: { expectedAgencyId?: number } = {},
): Promise<MessengerIngestResult> {
  const event = parseMessagingEvent(pageId, raw)
  if (event.kind === 'ignored') return { status: 'ignored', reason: event.reason }

  const connection = await db('facebook_pages').where({ page_id: pageId }).first('agency_id')
  if (!connection) return { status: 'ignored', reason: 'no_connection' }
  const agencyId = Number(connection.agency_id)
  // A receipt recorded for one agency is never stored under another: if the Page
  // changed hands between receipt and processing, the message belongs to neither.
  if (opts.expectedAgencyId !== undefined && opts.expectedAgencyId !== agencyId) {
    return { status: 'ignored', reason: 'tenant_changed' }
  }
  if (!isFacebookMessengerEnabledForAgency(agencyId)) return { status: 'ignored', reason: 'not_enabled' }

  // ── Non-message events ────────────────────────────────────────────────────
  // Handled before the message path so the message path keeps its exact shape.
  if (event.kind !== 'inbound' && event.kind !== 'echo') {
    return db.transaction(async (trx) => {
      // A signal about a conversation we have never seen is not worth creating
      // one for — there is nothing to attach it to and no message to mark.
      const existing = await trx('messenger_conversations')
        .where({ agencyId, pageId, psid: event.psid })
        .first('id')
      if (!existing) return { status: 'ignored', reason: 'no_conversation' } as const
      const conversationId = Number(existing.id)

      if (event.kind === 'delivery' || event.kind === 'read') {
        const applied = await applyMessengerWatermark(trx, {
          conversationId,
          agencyId,
          field: event.kind === 'delivery' ? 'deliveredAt' : 'readAt',
          watermark: event.watermark,
        })
        return { status: 'signal', kind: event.kind, conversationId, agencyId, applied } as const
      }

      const eventKey = messengerEventKey(event)
      if (!eventKey) return { status: 'ignored', reason: 'no_event_key' } as const
      const occurredAt = event.timestamp ?? new Date()
      const detail =
        event.kind === 'postback'
          ? { title: event.title, payload: event.payload ?? event.referralRef, targetMid: null }
          : event.kind === 'referral'
            ? { title: event.source, payload: event.ref ?? event.refType, targetMid: null }
            : { title: event.action, payload: event.emoji, targetMid: event.targetMid }

      const id = await insertMessengerEvent(trx, {
        conversationId,
        agencyId,
        pageId,
        kind: event.kind,
        eventKey,
        ...detail,
        occurredAt,
      })
      return { status: 'signal', kind: event.kind, conversationId, agencyId, applied: id === null ? 0 : 1 } as const
    })
  }

  // Narrowed above; `kind` is now inbound | echo.
  const direction: 'inbound' | 'outbound' = event.kind === 'inbound' ? 'inbound' : 'outbound'
  const source =
    event.kind === 'inbound' ? 'customer' : echoSource((event as { appId: string | null }).appId, process.env.META_APP_ID)
  const at = event.timestamp ?? new Date()

  return db.transaction(async (trx) => {
    const conversation = await findOrCreateMessengerConversation(trx, { agencyId, pageId, psid: event.psid })

    const messageId = await insertMessengerMessage(trx, {
      conversationId: conversation.id,
      agencyId,
      pageId,
      mid: event.mid,
      direction,
      source,
      text: event.text,
      attachments: event.attachments,
      channelTimestamp: event.timestamp,
    })
    if (messageId === null) {
      if (direction !== 'inbound') return { status: 'duplicate' } as const
      const stored = await trx('messenger_messages')
        .where({ pageId, mid: event.mid, agencyId, direction: 'inbound' })
        .first('id', 'conversationId', 'channelTimestamp', 'createdAt')
      if (!stored) return { status: 'duplicate' } as const
      return {
        status: 'duplicate',
        inbound: {
          conversationId: Number(stored.conversationId),
          agencyId,
          messageId: Number(stored.id),
          occurredAt: new Date(stored.channelTimestamp ?? stored.createdAt),
          storedAt: new Date(stored.createdAt),
        },
      } as const
    }

    await bumpMessengerConversation(trx, {
      conversationId: conversation.id,
      direction,
      at,
      text: event.text,
      attachments: event.attachments,
    })
    return {
      status: 'stored',
      conversationId: conversation.id,
      agencyId,
      direction,
      newConversation: conversation.created,
      messageId,
      occurredAt: at,
    } as const
  })
}
