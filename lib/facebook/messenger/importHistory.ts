import { db } from '@/config/db'
import { graphRequest, describeGraphError, type MetaGraphError } from '@/lib/facebook/graphClient'
import {
  bumpMessengerConversation,
  findOrCreateMessengerConversation,
  insertMessengerMessage,
} from '@/db/messenger'
import type { MessengerAttachment, MessengerAttachmentType } from '@/lib/facebook/messenger/parseMessagingEvent'

/**
 * Import the conversations a Page already has, so a newly connected inbox is
 * not empty until someone happens to write again.
 *
 * WHAT META ACTUALLY GIVES US — and the honest limit. `GET /{PAGE-ID}/conversations`
 * with `platform=messenger` lists threads, but per
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations
 * (checked 2026-09-23) "you can only get details about the 20 most recent
 * messages in the conversation". There is no parameter that lifts it. So this
 * recovers RECENT history, never full history, and `historyImportedAt` exists
 * precisely so the UI can say so instead of implying the thread is complete.
 *
 * Needs `pages_messaging`, `pages_manage_metadata` and `pages_read_engagement`
 * — all of which the Page connection already requests for Messenger.
 *
 * IDEMPOTENT. Every message goes through the same ("pageId", mid) uniqueness as
 * the webhook, so importing twice, or importing a thread the webhook has already
 * delivered, changes nothing.
 *
 * SILENT BY DESIGN. It writes through the db layer directly and never goes near
 * the notification path: these are messages from the past, and announcing them
 * would tell a rep that thirty people just wrote in.
 *
 * NEVER THROWS.
 */

/** Threads per import. A bound, not a page size — see `hasMore` in the result. */
const CONVERSATION_LIMIT = 50

/** Meta's own ceiling; asking for more does not return more. */
const MESSAGES_PER_CONVERSATION = 20

export type MessengerImportResult = {
  conversations: number
  messages: number
  /** True when Meta had more threads than this run imported. */
  hasMore: boolean
  failure: 'permission' | 'rate_limited' | 'meta_error' | null
}

type GraphMessage = {
  id?: unknown
  message?: unknown
  created_time?: unknown
  from?: { id?: unknown; name?: unknown }
  to?: { data?: { id?: unknown; name?: unknown }[] }
  attachments?: { data?: { mime_type?: unknown; image_data?: unknown; video_data?: unknown; file_url?: unknown; name?: unknown }[] }
}

type GraphConversation = {
  id?: unknown
  updated_time?: unknown
  participants?: { data?: { id?: unknown; name?: unknown }[] }
  messages?: { data?: GraphMessage[] }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function when(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The Conversations API describes attachments differently from the webhook
 * (mime_type + image_data/video_data/file_url, not type + payload.url). Mapped
 * to the one shape the thread renders, so an imported photo looks like a
 * received one.
 */
function mapAttachments(raw: GraphMessage['attachments']): MessengerAttachment[] {
  const list = Array.isArray(raw?.data) ? raw.data : []
  return list.slice(0, 10).map((a) => {
    const mime = (str(a?.mime_type) ?? '').toLowerCase()
    const url =
      str((a?.image_data as { url?: unknown } | undefined)?.url) ??
      str((a?.video_data as { url?: unknown } | undefined)?.url) ??
      str(a?.file_url)
    const type: MessengerAttachmentType = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : url
            ? 'file'
            : 'unsupported'
    return { type, url: url && url.startsWith('https://') ? url : null }
  })
}

function classify(error: MetaGraphError): MessengerImportResult['failure'] {
  if (error.kind !== 'graph') return 'meta_error'
  const { code } = error
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limited'
  if (code === 10 || code === 190 || (code !== null && code >= 200 && code <= 299)) return 'permission'
  return 'meta_error'
}

export async function importMessengerHistory(input: {
  agencyId: number
  pageId: string
  pageAccessToken: string
  fetchImpl?: typeof fetch
}): Promise<MessengerImportResult> {
  const summary: MessengerImportResult = { conversations: 0, messages: 0, hasMore: false, failure: null }

  const result = await graphRequest<{ data?: GraphConversation[]; paging?: unknown }>({
    path: `/${encodeURIComponent(input.pageId)}/conversations`,
    token: input.pageAccessToken,
    query: {
      platform: 'messenger',
      fields: `updated_time,participants,messages.limit(${MESSAGES_PER_CONVERSATION}){id,message,created_time,from,to,attachments}`,
      limit: CONVERSATION_LIMIT,
    },
    timeoutMs: 20_000,
    fetchImpl: input.fetchImpl,
  })

  if ('error' in result) {
    console.warn('[MessengerImport] Meta refused the conversation list', { detail: describeGraphError(result.error) })
    return { ...summary, failure: classify(result.error) }
  }

  const conversations = Array.isArray(result.data?.data) ? result.data.data : []
  // `graphClient` strips paging URLs (they embed the token), so "more exist" is
  // inferred from a full page rather than from a cursor we deliberately discard.
  summary.hasMore = conversations.length >= CONVERSATION_LIMIT

  for (const conversation of conversations) {
    // The PSID is the participant that is NOT the Page. A thread whose
    // participants we cannot read is skipped rather than guessed at — storing a
    // conversation under the wrong id would be worse than not importing it.
    const participants = Array.isArray(conversation?.participants?.data) ? conversation.participants.data : []
    const psid = participants.map((p) => str(p?.id)).find((id) => id && id !== input.pageId)
    if (!psid) continue

    const messages = Array.isArray(conversation?.messages?.data) ? conversation.messages.data : []
    if (messages.length === 0) continue

    // A display name from the thread is better than nothing while the User
    // Profile API is unapproved — but only the CUSTOMER's, never the Page's.
    const customerName = str(participants.find((p) => str(p?.id) === psid)?.name)

    try {
      await db.transaction(async (trx) => {
        const row = await findOrCreateMessengerConversation(trx, {
          agencyId: input.agencyId,
          pageId: input.pageId,
          psid,
        })
        summary.conversations++

        // Oldest first, so each `bump` moves the summary forward monotonically.
        const ordered = [...messages].sort((a, b) => (when(a.created_time)?.getTime() ?? 0) - (when(b.created_time)?.getTime() ?? 0))

        for (const message of ordered) {
          const mid = str(message?.id)
          if (!mid) continue
          const fromId = str(message?.from?.id)
          // `from` is the Page for anything the business sent — from SocialCRM,
          // from Business Suite, or from any other connected tool. The import
          // cannot tell them apart, so it does not pretend to: 'page_inbox' is
          // the honest label for "the business sent this, not from here".
          const direction: 'inbound' | 'outbound' = fromId === input.pageId ? 'outbound' : 'inbound'
          const attachments = mapAttachments(message?.attachments)
          const at = when(message?.created_time)

          const inserted = await insertMessengerMessage(trx, {
            conversationId: row.id,
            agencyId: input.agencyId,
            pageId: input.pageId,
            mid,
            direction,
            source: direction === 'inbound' ? 'customer' : 'page_inbox',
            text: str(message?.message) ?? '',
            attachments,
            channelTimestamp: at,
          })
          // null ⇒ the webhook already has it. Not an error, and not counted.
          if (inserted === null) continue
          summary.messages++
          await bumpMessengerConversation(trx, {
            conversationId: row.id,
            direction,
            at: at ?? new Date(),
            text: str(message?.message) ?? '',
            attachments,
          })
        }

        await trx('messenger_conversations')
          .where({ id: row.id, agencyId: input.agencyId })
          .update({
            historyImportedAt: new Date(),
            // Never overwrite a name we already have — the User Profile API's is
            // better than a thread participant label.
            customerName: trx.raw(`COALESCE("customerName", ?)`, [customerName ? customerName.slice(0, 200) : null]),
            updatedAt: trx.fn.now(),
          })
      })
    } catch (err) {
      // One bad thread must not abandon the rest of the import.
      console.error('[MessengerImport] conversation failed:', err instanceof Error ? err.message : 'unknown')
    }
  }

  return summary
}
