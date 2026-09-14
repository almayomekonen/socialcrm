import { db } from '@/config/db'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { echoSource, parseMessagingEvent } from '@/lib/facebook/messenger/parseMessagingEvent'
import {
  bumpMessengerConversation,
  findOrCreateMessengerConversation,
  insertMessengerMessage,
} from '@/db/messenger'

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
 * FAILURE. THROWS on a database error; handleMessagingEntries decides whether
 * one immediate in-request retry is worthwhile (transient errors only).
 */

export type MessengerIngestResult =
  | {
      status: 'stored'
      conversationId: number
      agencyId: number
      direction: 'inbound' | 'outbound'
      /** First message of a new conversation — the one moment a name lookup is worth a Graph call. */
      newConversation: boolean
    }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string }

export async function ingestMessengerEvent(pageId: string, raw: unknown): Promise<MessengerIngestResult> {
  const event = parseMessagingEvent(pageId, raw)
  if (event.kind === 'ignored') return { status: 'ignored', reason: event.reason }

  const connection = await db('facebook_pages').where({ page_id: pageId }).first('agency_id')
  if (!connection) return { status: 'ignored', reason: 'no_connection' }
  const agencyId = Number(connection.agency_id)
  if (!isFacebookMessengerEnabledForAgency(agencyId)) return { status: 'ignored', reason: 'not_enabled' }

  // Narrowed by the `ignored` return above; `kind` is now inbound | echo.
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
    if (messageId === null) return { status: 'duplicate' } as const

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
    } as const
  })
}
